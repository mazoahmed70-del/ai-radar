# AI Radar

A live AI news radar. A GitHub Action collects stories from 25 public RSS feeds
(OpenAI, Google DeepMind, Anthropic, Hugging Face, TechCrunch, The Verge, Wired,
Ars Technica, MIT Tech Review, arXiv, Hacker News and more) every 30 minutes and
saves them to `docs/data/news.json`. GitHub Pages serves the site from `docs/`.

- `scripts/collect.py` collects, de-duplicates and tags the news
- `.github/workflows/collect.yml` runs the collector on a schedule
- `docs/` is the website (plain HTML, CSS and JavaScript)

Run it locally: `pip install -r scripts/requirements.txt && python scripts/collect.py`,
then serve `docs/` with any static server.

To add a source, append a line to `FEEDS` in `scripts/collect.py`.
