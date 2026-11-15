#!/usr/bin/env python3
"""AI Radar collector: gathers AI news from public RSS/Atom feeds into docs/data/news.json.
Runs on a schedule in GitHub Actions (see .github/workflows/collect.yml)."""
import calendar
import concurrent.futures as cf
import hashlib
import html
import json
import os
import re
import time
from collections import Counter

import feedparser
import requests

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "news.json")
REFRESH_SECONDS = 30 * 60
MAX_AGE_DAYS = 10
UA = {"User-Agent": "Mozilla/5.0 (AI-Radar news reader)"}

# name, url, group, cap (max items kept per sweep)
FEEDS = [
    ("OpenAI", "https://openai.com/news/rss.xml", "Labs", 25),
    ("Google DeepMind", "https://deepmind.google/blog/rss.xml", "Labs", 25),
    ("Google AI", "https://blog.google/technology/ai/rss/", "Labs", 20),
    ("Anthropic", "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml", "Labs", 25),
    ("Mistral AI", "https://mistral.ai/rss.xml", "Labs", 20),
    ("Hugging Face", "https://huggingface.co/blog/feed.xml", "Labs", 25),
    ("NVIDIA", "https://blogs.nvidia.com/feed/", "Labs", 20),
    ("AWS ML", "https://aws.amazon.com/blogs/machine-learning/feed/", "Labs", 20),
    ("TechCrunch", "https://techcrunch.com/category/artificial-intelligence/feed/", "Media", 30),
    ("The Verge", "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", "Media", 30),
    ("Wired", "https://www.wired.com/feed/tag/ai/latest/rss", "Media", 30),
    ("Ars Technica", "https://arstechnica.com/ai/feed/", "Media", 30),
    ("MIT Tech Review", "https://www.technologyreview.com/topic/artificial-intelligence/feed", "Media", 30),
    ("ZDNet", "https://www.zdnet.com/topic/artificial-intelligence/rss.xml", "Media", 30),
    ("The Decoder", "https://the-decoder.com/feed/", "Media", 30),
    ("MarkTechPost", "https://www.marktechpost.com/feed/", "Media", 30),
    ("Google News", "https://news.google.com/rss/search?q=artificial+intelligence+when:2d&hl=en-US&gl=US&ceid=US:en", "Media", 35),
    ("arXiv cs.AI", "http://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=25", "Research", 25),
    ("arXiv cs.CL", "http://export.arxiv.org/api/query?search_query=cat:cs.CL&sortBy=submittedDate&sortOrder=descending&max_results=25", "Research", 25),
    ("BAIR", "https://bair.berkeley.edu/blog/feed.xml", "Research", 10),
    ("Import AI", "https://importai.substack.com/feed", "Newsletters", 15),
    ("Last Week in AI", "https://lastweekin.ai/feed", "Newsletters", 15),
    ("Simon Willison", "https://simonwillison.net/atom/everything/", "Community", 30),
    ("Hacker News", "https://hnrss.org/newest?q=AI+OR+LLM+OR+GPT+OR+OpenAI+OR+Anthropic&points=50", "Community", 30),
    ("r/MachineLearning", "https://www.reddit.com/r/MachineLearning/.rss", "Community", 25),
]

CATEGORIES = {
    "Models": r"\b(gpt-?\d|gemini|claude|llama|mistral|qwen|deepseek|grok|model|llm|release[sd]?|launch(es|ed)?|open[- ]weights?|multimodal|reasoning model|o\d\b|sora|veo|diffusion)\b",
    "Research": r"\b(paper|arxiv|research|study|benchmark|dataset|training|architecture|transformer|reinforcement|alignment research|we propose|novel|theorem|evaluation)\b",
    "Business": r"\b(funding|raises?|raised|valuation|ipo|acquire[sd]?|acquisition|revenue|investors?|startup|billion|million|deal|partnership|stock|shares|earnings|layoffs?|hiring|ceo)\b",
    "Policy": r"\b(regulat\w*|law|lawsuit|sued|court|congress|senate|eu ai act|policy|government|ban|copyright|safety|ethic\w*|privacy|election|military|pentagon|white house|antitrust)\b",
    "Tools": r"\b(agents?|agentic|api|sdk|open[- ]source|github|copilot|coding|developer|plugin|app|feature|tool|framework|library|tutorial|how to|guide|workflow)\b",
    "Hardware": r"\b(gpu|chips?|nvidia|tpu|semiconductor|data ?cent(er|re)s?|compute|blackwell|h100|h200|b200|amd|intel|tsmc|power grid|energy|robot\w*)\b",
}
CAT_RE = {k: re.compile(v, re.I) for k, v in CATEGORIES.items()}

SIGNALS = [
    "OpenAI", "Anthropic", "Google", "DeepMind", "Gemini", "Claude", "ChatGPT", "GPT-5", "GPT", "Meta",
    "Llama", "Microsoft", "Copilot", "NVIDIA", "Apple", "Amazon", "xAI", "Grok", "Mistral", "DeepSeek",
    "Qwen", "Hugging Face", "Perplexity", "Agents", "Robotics", "Open source", "Regulation", "Chips",
    "Sora", "Veo", "Tesla", "Samsung", "AMD", "Midjourney", "Cursor", "IPO", "Funding", "Lawsuit",
]
SIGNAL_RE = {s: re.compile(r"\b" + re.escape(s).replace(r"\ ", r"[ -]") + (r"s?" if s in ("Agents", "Chips") else "") + r"\b", re.I) for s in SIGNALS}

AI_FILTER = re.compile(r"\b(ai|a\.i\.|artificial intelligence|machine learning|llms?|gpt|chatbot|neural|openai|anthropic|gemini|claude|deepmind|model|agentic|agents?|copilot|nvidia|robot\w*)\b", re.I)
GENERIC_FEEDS = {"NVIDIA", "Hacker News", "ZDNet"}

TAG_RE = re.compile(r"<[^>]+>")
IMG_RE = re.compile(r"<img[^>]+src=[\"']([^\"']+)[\"']", re.I)
WS_RE = re.compile(r"\s+")


def clean(text, limit=320):
    if not text:
        return ""
    t = html.unescape(TAG_RE.sub(" ", text))
    t = WS_RE.sub(" ", t).strip()
    t = re.sub(r"The post .+? appeared first on .+?\.?$", "", t).strip()
    if len(t) > limit:
        t = t[:limit].rsplit(" ", 1)[0] + "…"
    return t


def entry_time(e):
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        v = e.get(key)
        if v:
            try:
                return calendar.timegm(v)
            except Exception:
                pass
    return None


def entry_image(e):
    for key in ("media_thumbnail", "media_content"):
        v = e.get(key)
        if v and isinstance(v, list) and v[0].get("url"):
            return v[0]["url"]
    for l in e.get("links", []):
        if l.get("rel") == "enclosure" and str(l.get("type", "")).startswith("image"):
            return l.get("href")
    for field in ("summary", "content"):
        raw = e.get(field)
        if isinstance(raw, list) and raw:
            raw = raw[0].get("value", "")
        if raw:
            m = IMG_RE.search(raw)
            if m and m.group(1).startswith("http"):
                return m.group(1)
    return None


def categorize(text, group):
    hits = [(k, len(r.findall(text))) for k, r in CAT_RE.items()]
    hits = [h for h in hits if h[1] > 0]
    if group == "Research":
        return "Research"
    if not hits:
        return "General"
    hits.sort(key=lambda h: -h[1])
    return hits[0][0]


def norm_title(t):
    return re.sub(r"[^a-z0-9 ]", "", t.lower())[:90]


def fetch_one(feed):
    name, url, group, cap = feed
    started = time.time()
    try:
        r = requests.get(url, headers=UA, timeout=20)
        if r.status_code >= 400:
            return name, group, [], f"HTTP {r.status_code}", time.time() - started
        parsed = feedparser.parse(r.content)
        out = []
        now = time.time()
        for e in parsed.entries[: cap * 3]:
            title = clean(e.get("title", ""), 220)
            link = e.get("link")
            if not title or not link:
                continue
            ts = entry_time(e) or now
            if now - ts > MAX_AGE_DAYS * 86400:
                continue
            raw_summary = e.get("summary", "")
            if not raw_summary and e.get("content"):
                raw_summary = e["content"][0].get("value", "")
            summary = clean(raw_summary)
            publisher = name
            if name == "Google News":
                src = e.get("source", {})
                publisher = (src.get("title") if isinstance(src, dict) else None) or "Google News"
                title = re.sub(r"\s+-\s+[^-]+$", "", title)
                summary = ""
            if name == "Hacker News":
                summary = ""
            if name == "r/MachineLearning" and "[D]" in title and "Self-Promotion" in title:
                continue
            text = f"{title} {summary}"
            if name in GENERIC_FEEDS and not AI_FILTER.search(text):
                continue
            out.append({
                "id": hashlib.sha1(link.encode()).hexdigest()[:14],
                "title": title,
                "url": link,
                "summary": summary,
                "source": name,
                "publisher": publisher,
                "group": group,
                "category": categorize(text, group),
                "published": int(ts),
                "image": entry_image(e),
            })
            if len(out) >= cap:
                break
        return name, group, out, "ok", time.time() - started
    except Exception as ex:
        return name, group, [], f"error: {type(ex).__name__}", time.time() - started


def compute_signals(items):
    cutoff = time.time() - 48 * 3600
    c = Counter()
    for it in items:
        if it["published"] < cutoff:
            continue
        text = it["title"] + " " + it["summary"]
        for s, r in SIGNAL_RE.items():
            if r.search(text):
                c[s] += 1
    return [{"term": k, "count": v} for k, v in c.most_common(14)]



def main():
    prev = {}
    try:
        with open(OUT) as f:
            prev = json.load(f)
    except Exception:
        pass
    with cf.ThreadPoolExecutor(12) as ex:
        results = list(ex.map(fetch_one, FEEDS))
    items, sources, seen = [], [], set()
    for name, group, its, status, dur in results:
        kept = 0
        for it in its:
            key = norm_title(it["title"])
            if key in seen:
                continue
            seen.add(key)
            items.append(it)
            kept += 1
        sources.append({"name": name, "group": group, "status": status, "count": kept, "ms": int(dur * 1000)})
    # keep earlier stories from feeds that failed this run
    failed = {s["name"] for s in sources if s["status"] != "ok"}
    cutoff = time.time() - MAX_AGE_DAYS * 86400
    for it in prev.get("items", []):
        if it["source"] in failed and it["published"] >= cutoff and norm_title(it["title"]) not in seen:
            seen.add(norm_title(it["title"]))
            items.append(it)
    for s in sources:
        if s["name"] in failed:
            s["count"] = sum(1 for i in items if i["source"] == s["name"])
    items.sort(key=lambda i: -i["published"])
    now = int(time.time())
    data = {
        "fetched_at": now,
        "next_sweep": now + REFRESH_SECONDS,
        "items": items,
        "sources": sources,
        "signals": compute_signals(items),
        "categories": list(CATEGORIES.keys()) + ["General"],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    ok = sum(1 for s in sources if s["status"] == "ok")
    print(f"Collected {len(items)} stories from {ok}/{len(sources)} sources")


if __name__ == "__main__":
    main()
