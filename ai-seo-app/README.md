# AI SEO Studio

A full-stack student MVP for explainable website SEO audits and multi-provider AI content optimization.

## Project aims covered
- Improve visibility and content discoverability for traditional and AI-powered search.
- Audit technical, content, structural, accessibility and AI-readiness signals.
- Generate actionable recommendations rather than unexplained scores.
- Support user-selected AI providers using user-supplied API keys.
- Save websites, audit history and AI generation history in a dashboard.
- Remain useful without AI through a rule-based SEO analyzer and Demo Mode.

## Main features
1. Registration and login
2. Website management
3. Public webpage crawler
4. Explainable 0–100 SEO score
5. Audit categories: title, meta description, H1/H2, image alt text, viewport, canonical, content depth, internal links, JSON-LD and response time
6. AI SEO optimizer for content, metadata, keywords, FAQs and outlines
7. OpenRouter, Google AI Studio, Groq and OpenCode Zen adapters
8. Demo Mode requiring no API key
9. Audit and AI history dashboard
10. Responsive interface

## Run locally
```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env   # Windows
# cp .env.example .env   # macOS/Linux
python app.py
```
Open `http://127.0.0.1:5000`.

## Run tests
```bash
pytest -q
```

## AI provider setup
The user selects a provider, enters a currently valid model ID and API key, and presses **Test connection**. The API key is not stored in the database. It is used only in the current HTTP request.

Default model IDs are configuration examples requested for this project. Free-tier availability, exact model IDs, quotas and preview status can change. Keep model IDs editable and verify them in each provider's console before a demonstration.

## Security design
- Passwords are hashed.
- API keys are not stored.
- AI API calls happen on the backend, not directly in browser JavaScript.
- localhost and common private-network URL targets are blocked to reduce SSRF risk.
- Submitted page size is limited and crawler timeouts are applied.
- External links opened by the UI use `noopener`.

## Scope limitations
- The crawler analyzes one HTML page per audit, not an entire domain.
- Response time is a simple server-fetch measurement, not Core Web Vitals.
- The app detects JSON-LD but does not fully validate every schema type.
- It does not guarantee ranking or AI citation.
- Real keyword volume/ranking requires a separate search-data provider or Google Search Console integration.
- The MVP uses SQLite. MySQL can be enabled by changing `DATABASE_URL` and installing a compatible driver.

## Suggested future extensions
- Multi-page crawl and sitemap discovery
- Google Search Console integration
- scheduled weekly audits and email notifications
- PDF report export
- WordPress publishing integration
- encrypted persistent provider settings
- team roles and shared workspaces
