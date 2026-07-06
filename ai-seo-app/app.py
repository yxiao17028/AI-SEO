import json
import os
import re
import secrets
from datetime import datetime
from functools import wraps
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from flask import Flask, flash, jsonify, redirect, render_template, request, session, url_for
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

load_dotenv()

db = SQLAlchemy()

PROVIDERS = {
    "openrouter": {
        "name": "OpenRouter",
        "type": "openai_compatible",
        "base_url": "https://openrouter.ai/api/v1/chat/completions",
        "default_model": "openai/gpt-oss-120b:free",
        "note": "Free model availability and limits may change.",
    },
    "gemini": {
        "name": "Google AI Studio",
        "type": "gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        "default_model": "gemini-3.5-flash",
        "note": "Use a model ID currently available in your Google AI Studio account.",
    },
    "opencode": {
        "name": "OpenCode Zen",
        "type": "openai_compatible",
        "base_url": "https://opencode.ai/zen/v1/chat/completions",
        "default_model": "deepseek-v4-flash-free",
        "note": "Free access is promotional and may be temporary.",
    },
    "groq": {
        "name": "Groq",
        "type": "openai_compatible",
        "base_url": "https://api.groq.com/openai/v1/chat/completions",
        "default_model": "meta-llama/llama-4-scout-17b-16e-instruct",
        "note": "Preview models may be changed or discontinued.",
    },
    "demo": {
        "name": "Demo Mode (No API Key)",
        "type": "demo",
        "base_url": "",
        "default_model": "local-demo",
        "note": "Produces deterministic sample recommendations for presentation and testing.",
    },
}


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(160), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Website(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    url = db.Column(db.String(500), nullable=False)
    industry = db.Column(db.String(120), default="")
    target_audience = db.Column(db.String(250), default="")
    target_country = db.Column(db.String(80), default="Malaysia")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    analyses = db.relationship("Analysis", backref="website", cascade="all, delete-orphan")


class Analysis(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    website_id = db.Column(db.Integer, db.ForeignKey("website.id"), nullable=False)
    score = db.Column(db.Integer, nullable=False)
    passed = db.Column(db.Integer, default=0)
    warnings = db.Column(db.Integer, default=0)
    critical = db.Column(db.Integer, default=0)
    payload = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class AIResult(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    provider = db.Column(db.String(50), nullable=False)
    model = db.Column(db.String(150), nullable=False)
    task = db.Column(db.String(60), nullable=False)
    input_excerpt = db.Column(db.Text, default="")
    payload = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


def create_app(test_config=None):
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.getenv("SECRET_KEY", secrets.token_hex(24)),
        SQLALCHEMY_DATABASE_URI=os.getenv("DATABASE_URL", "sqlite:///ai_seo.db"),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        REQUEST_TIMEOUT=int(os.getenv("REQUEST_TIMEOUT", "15")),
        MAX_CONTENT_LENGTH=2 * 1024 * 1024,
    )
    if test_config:
        app.config.update(test_config)
    db.init_app(app)

    with app.app_context():
        db.create_all()

    def login_required(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if not session.get("user_id"):
                return redirect(url_for("login"))
            return view(*args, **kwargs)
        return wrapped

    def current_user():
        return db.session.get(User, session.get("user_id")) if session.get("user_id") else None

    @app.context_processor
    def inject_globals():
        return {"current_user": current_user(), "providers": PROVIDERS}

    @app.route("/")
    def index():
        return redirect(url_for("dashboard")) if session.get("user_id") else render_template("landing.html")

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            if not name or not email or len(password) < 8:
                flash("Enter a name, valid email, and password of at least 8 characters.", "error")
            elif User.query.filter_by(email=email).first():
                flash("An account with that email already exists.", "error")
            else:
                user = User(name=name, email=email, password_hash=generate_password_hash(password))
                db.session.add(user)
                db.session.commit()
                session["user_id"] = user.id
                flash("Account created successfully.", "success")
                return redirect(url_for("dashboard"))
        return render_template("auth.html", mode="register")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            user = User.query.filter_by(email=email).first()
            if user and check_password_hash(user.password_hash, password):
                session.clear()
                session["user_id"] = user.id
                flash("Welcome back.", "success")
                return redirect(url_for("dashboard"))
            flash("Incorrect email or password.", "error")
        return render_template("auth.html", mode="login")

    @app.route("/logout")
    def logout():
        session.clear()
        return redirect(url_for("index"))

    @app.route("/dashboard")
    @login_required
    def dashboard():
        websites = Website.query.filter_by(user_id=session["user_id"]).order_by(Website.created_at.desc()).all()
        analyses = (Analysis.query.join(Website).filter(Website.user_id == session["user_id"])
                    .order_by(Analysis.created_at.desc()).limit(10).all())
        ai_results = AIResult.query.filter_by(user_id=session["user_id"]).order_by(AIResult.created_at.desc()).limit(5).all()
        average = round(sum(a.score for a in analyses) / len(analyses)) if analyses else 0
        return render_template("dashboard.html", websites=websites, analyses=analyses,
                               ai_results=ai_results, average=average)

    @app.route("/websites", methods=["GET", "POST"])
    @login_required
    def websites():
        if request.method == "POST":
            url = normalize_url(request.form.get("url", ""))
            if not valid_public_url(url):
                flash("Enter a valid public HTTP or HTTPS URL.", "error")
            else:
                website = Website(
                    user_id=session["user_id"],
                    name=request.form.get("name", "").strip() or urlparse(url).netloc,
                    url=url,
                    industry=request.form.get("industry", "").strip(),
                    target_audience=request.form.get("target_audience", "").strip(),
                    target_country=request.form.get("target_country", "Malaysia").strip(),
                )
                db.session.add(website)
                db.session.commit()
                flash("Website added.", "success")
                return redirect(url_for("websites"))
        items = Website.query.filter_by(user_id=session["user_id"]).order_by(Website.created_at.desc()).all()
        return render_template("websites.html", websites=items)

    @app.post("/websites/<int:website_id>/delete")
    @login_required
    def delete_website(website_id):
        website = Website.query.filter_by(id=website_id, user_id=session["user_id"]).first_or_404()
        db.session.delete(website)
        db.session.commit()
        flash("Website deleted.", "success")
        return redirect(url_for("websites"))

    @app.route("/analyze/<int:website_id>", methods=["POST"])
    @login_required
    def analyze(website_id):
        website = Website.query.filter_by(id=website_id, user_id=session["user_id"]).first_or_404()
        try:
            html, final_url, response_time = fetch_page(website.url, app.config["REQUEST_TIMEOUT"])
            result = analyze_html(html, final_url, response_time)
            analysis = Analysis(
                website_id=website.id,
                score=result["score"],
                passed=result["summary"]["passed"],
                warnings=result["summary"]["warnings"],
                critical=result["summary"]["critical"],
                payload=json.dumps(result, ensure_ascii=False),
            )
            db.session.add(analysis)
            db.session.commit()
            flash("SEO analysis completed.", "success")
            return redirect(url_for("analysis_detail", analysis_id=analysis.id))
        except Exception as exc:
            flash(f"Analysis failed: {friendly_error(exc)}", "error")
            return redirect(url_for("websites"))

    @app.route("/analysis/<int:analysis_id>")
    @login_required
    def analysis_detail(analysis_id):
        analysis = (Analysis.query.join(Website)
                    .filter(Analysis.id == analysis_id, Website.user_id == session["user_id"]).first_or_404())
        return render_template("analysis.html", analysis=analysis, data=json.loads(analysis.payload))

    @app.route("/ai", methods=["GET", "POST"])
    @login_required
    def ai_optimizer():
        result = None
        if request.method == "POST":
            provider_id = request.form.get("provider", "demo")
            config = PROVIDERS.get(provider_id)
            if not config:
                flash("Unsupported provider.", "error")
                return redirect(url_for("ai_optimizer"))
            api_key = request.form.get("api_key", "").strip()
            model = request.form.get("model", "").strip() or config["default_model"]
            task = request.form.get("task", "content_optimization")
            content = request.form.get("content", "").strip()
            keyword = request.form.get("keyword", "").strip()
            business = request.form.get("business", "").strip()
            if not content:
                flash("Paste website content to optimize.", "error")
            elif provider_id != "demo" and not api_key:
                flash("Enter your API key or use Demo Mode.", "error")
            else:
                try:
                    prompt = build_seo_prompt(task, content, keyword, business)
                    raw = call_provider(config, api_key, model, prompt, app.config["REQUEST_TIMEOUT"])
                    result = normalize_ai_result(raw, content, keyword)
                    record = AIResult(user_id=session["user_id"], provider=provider_id, model=model,
                                      task=task, input_excerpt=content[:500],
                                      payload=json.dumps(result, ensure_ascii=False))
                    db.session.add(record)
                    db.session.commit()
                    flash("AI SEO recommendation generated.", "success")
                except Exception as exc:
                    flash(f"AI request failed: {friendly_error(exc)}", "error")
        return render_template("ai.html", result=result)

    @app.post("/api/ai/test-connection")
    @login_required
    def test_connection():
        data = request.get_json(silent=True) or {}
        provider_id = data.get("provider", "")
        config = PROVIDERS.get(provider_id)
        if not config:
            return jsonify(success=False, message="Unsupported provider."), 400
        try:
            if provider_id == "demo":
                return jsonify(success=True, message="Demo Mode is ready.")
            call_provider(config, data.get("api_key", ""), data.get("model") or config["default_model"],
                          "Reply only with OK.", app.config["REQUEST_TIMEOUT"])
            return jsonify(success=True, message="Connection successful.")
        except Exception as exc:
            return jsonify(success=False, message=friendly_error(exc)), 400

    @app.get("/api/providers")
    def provider_list():
        return jsonify({key: {k: v for k, v in cfg.items() if k != "base_url"}
                        for key, cfg in PROVIDERS.items()})

    @app.errorhandler(404)
    def not_found(_):
        return render_template("error.html", message="Page not found."), 404

    @app.errorhandler(413)
    def too_large(_):
        return render_template("error.html", message="The submitted content is too large."), 413

    return app


def normalize_url(url):
    url = url.strip()
    if url and not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


def valid_public_url(url):
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme not in {"http", "https"} or not host:
            return False
        if host in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
            return False
        if host.startswith(("10.", "192.168.", "169.254.")):
            return False
        if host.startswith("172."):
            second = int(host.split(".")[1]) if host.split(".")[1].isdigit() else -1
            if 16 <= second <= 31:
                return False
        return True
    except Exception:
        return False


def fetch_page(url, timeout):
    headers = {"User-Agent": "AISEOStudentProject/1.0 (+educational SEO audit)"}
    start = datetime.now()
    response = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
    response.raise_for_status()
    content_type = response.headers.get("Content-Type", "")
    if "text/html" not in content_type:
        raise ValueError("The URL did not return an HTML webpage.")
    elapsed = int((datetime.now() - start).total_seconds() * 1000)
    return response.text[:2_000_000], response.url, elapsed


def analyze_html(html, url, response_time):
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    meta_desc_tag = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    meta_desc = meta_desc_tag.get("content", "").strip() if meta_desc_tag else ""
    h1s = [x.get_text(" ", strip=True) for x in soup.find_all("h1")]
    h2s = [x.get_text(" ", strip=True) for x in soup.find_all("h2")]
    images = soup.find_all("img")
    missing_alt = sum(1 for img in images if not img.get("alt", "").strip())
    links = [a.get("href") for a in soup.find_all("a") if a.get("href")]
    host = urlparse(url).netloc
    internal_links = sum(1 for href in links if urlparse(urljoin(url, href)).netloc == host)
    canonical = soup.find("link", rel=lambda x: x and "canonical" in x)
    viewport = soup.find("meta", attrs={"name": re.compile("^viewport$", re.I)})
    json_ld = soup.find_all("script", attrs={"type": "application/ld+json"})
    text = " ".join(soup.stripped_strings)
    word_count = len(re.findall(r"\b\w+\b", text))

    checks = []

    def add(category, title_text, status, points, max_points, finding, recommendation):
        checks.append({"category": category, "title": title_text, "status": status,
                       "points": points, "max_points": max_points,
                       "finding": finding, "recommendation": recommendation})

    if 30 <= len(title) <= 60:
        add("Content", "Page title", "passed", 10, 10, f"Title length is {len(title)} characters.", "Keep the title specific and aligned with the page intent.")
    elif title:
        add("Content", "Page title", "warning", 5, 10, f"Title length is {len(title)} characters.", "Use a descriptive title of approximately 30–60 characters.")
    else:
        add("Content", "Page title", "critical", 0, 10, "No page title was found.", "Add a unique HTML title describing the page and primary topic.")

    if 70 <= len(meta_desc) <= 160:
        add("Content", "Meta description", "passed", 10, 10, f"Description length is {len(meta_desc)} characters.", "Keep it relevant and action-oriented.")
    elif meta_desc:
        add("Content", "Meta description", "warning", 5, 10, f"Description length is {len(meta_desc)} characters.", "Rewrite it to approximately 70–160 characters.")
    else:
        add("Content", "Meta description", "critical", 0, 10, "No meta description was found.", "Add a concise summary that encourages relevant searchers to click.")

    if len(h1s) == 1:
        add("Structure", "Primary heading", "passed", 10, 10, f"One H1 was found: {h1s[0][:100]}", "Keep one clear H1 that matches the page purpose.")
    elif len(h1s) == 0:
        add("Structure", "Primary heading", "critical", 0, 10, "No H1 was found.", "Add one clear H1 near the start of the main content.")
    else:
        add("Structure", "Primary heading", "warning", 5, 10, f"{len(h1s)} H1 headings were found.", "Use one primary H1 and organize subtopics with H2/H3 headings.")

    add("Structure", "Subheading structure", "passed" if h2s else "warning", 10 if h2s else 4, 10,
        f"{len(h2s)} H2 headings were found.", "Use descriptive H2 sections to make content easier to scan and understand.")

    if not images or missing_alt == 0:
        add("Accessibility", "Image alternative text", "passed", 10, 10, f"{len(images)} images checked; none are missing alt text.", "Continue using meaningful alt text for informative images.")
    else:
        ratio = missing_alt / len(images)
        points = 3 if ratio > 0.5 else 6
        add("Accessibility", "Image alternative text", "critical" if ratio > 0.5 else "warning", points, 10,
            f"{missing_alt} of {len(images)} images are missing alt text.", "Add concise alt text that explains each informative image.")

    add("Technical", "Mobile viewport", "passed" if viewport else "critical", 10 if viewport else 0, 10,
        "A viewport tag was found." if viewport else "No mobile viewport tag was found.",
        "Add a responsive viewport meta tag so the page displays correctly on phones.")

    add("Technical", "Canonical URL", "passed" if canonical else "warning", 10 if canonical else 5, 10,
        "A canonical link was found." if canonical else "No canonical link was found.",
        "Add a canonical URL to reduce duplicate-page ambiguity.")

    if word_count >= 300:
        add("Content", "Content depth", "passed", 10, 10, f"Approximately {word_count} words were detected.", "Keep the content accurate, focused, and useful.")
    elif word_count >= 120:
        add("Content", "Content depth", "warning", 6, 10, f"Approximately {word_count} words were detected.", "Add useful details, examples, and answers to common questions.")
    else:
        add("Content", "Content depth", "critical", 2, 10, f"Only approximately {word_count} words were detected.", "Expand the page with original information that directly answers user needs.")

    add("Links", "Internal links", "passed" if internal_links >= 2 else "warning", 10 if internal_links >= 2 else 5, 10,
        f"{internal_links} internal links were detected.", "Link to relevant services, guides, and supporting pages using descriptive anchor text.")

    add("AI Readiness", "Structured data", "passed" if json_ld else "warning", 10 if json_ld else 4, 10,
        f"{len(json_ld)} JSON-LD blocks were detected." if json_ld else "No JSON-LD structured data was detected.",
        "Add valid schema markup that matches the business and page type.")

    if response_time <= 1500:
        status, points = "passed", 10
    elif response_time <= 3000:
        status, points = "warning", 6
    else:
        status, points = "critical", 2
    add("Performance", "Server response", status, points, 10, f"The HTML response took about {response_time} ms.",
        "Reduce server response time, optimize hosting, and cache reusable content.")

    total = sum(c["points"] for c in checks)
    maximum = sum(c["max_points"] for c in checks)
    score = round(total / maximum * 100)
    summary = {"passed": sum(c["status"] == "passed" for c in checks),
               "warnings": sum(c["status"] == "warning" for c in checks),
               "critical": sum(c["status"] == "critical" for c in checks)}
    return {"url": url, "score": score, "summary": summary, "checks": checks,
            "page": {"title": title, "meta_description": meta_desc, "h1": h1s,
                     "word_count": word_count, "images": len(images), "internal_links": internal_links,
                     "response_time_ms": response_time}}


def build_seo_prompt(task, content, keyword, business):
    schema = {
        "content_score": 0,
        "primary_keyword": "",
        "secondary_keywords": [],
        "meta_title": "",
        "meta_description": "",
        "issues": [{"issue": "", "recommendation": ""}],
        "faq": [{"question": "", "answer": ""}],
        "improved_content": "",
    }
    return f"""You are an SEO content assistant. Perform the task: {task}.
Business context: {business or 'Not provided'}
Target keyword: {keyword or 'Infer a relevant keyword from the content'}

Return ONLY valid JSON matching this structure:
{json.dumps(schema, ensure_ascii=False)}

Rules:
- Do not promise search rankings.
- Do not invent business facts, statistics, awards, prices, or customer reviews.
- Keep the meta title concise and the meta description suitable for a search snippet.
- Make recommendations specific and actionable.
- Preserve the original meaning.

CONTENT:
{content[:30000]}"""


def call_provider(config, api_key, model, prompt, timeout):
    if config["type"] == "demo":
        return json.dumps(demo_ai_result(prompt))
    if not api_key:
        raise ValueError("An API key is required.")
    if config["type"] == "openai_compatible":
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        if config["name"] == "OpenRouter":
            headers.update({"HTTP-Referer": "http://localhost:5000", "X-Title": "AI SEO Student Project"})
        payload = {"model": model, "messages": [
            {"role": "system", "content": "Return only valid JSON. You are an accurate SEO assistant."},
            {"role": "user", "content": prompt}], "temperature": 0.2}
        response = requests.post(config["base_url"], headers=headers, json=payload, timeout=timeout)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]
    if config["type"] == "gemini":
        url = config["base_url"].format(model=model) + f"?key={api_key}"
        payload = {"contents": [{"parts": [{"text": prompt}]}],
                   "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"}}
        response = requests.post(url, json=payload, timeout=timeout)
        response.raise_for_status()
        data = response.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]
    raise ValueError("Unsupported provider type.")


def demo_ai_result(prompt):
    keyword_match = re.search(r"Target keyword:\s*(.+)", prompt)
    keyword = keyword_match.group(1).strip() if keyword_match else "AI SEO optimization"
    if keyword.startswith("Infer"):
        keyword = "website SEO optimization"
    return {
        "content_score": 76,
        "primary_keyword": keyword,
        "secondary_keywords": ["search visibility", "content discoverability", "technical SEO"],
        "meta_title": f"{keyword.title()} for Better Online Visibility"[:60],
        "meta_description": "Improve website visibility with practical SEO analysis, clearer content, structured data, and actionable AI-assisted recommendations.",
        "issues": [
            {"issue": "The opening does not state the main customer benefit clearly.",
             "recommendation": "Start with one direct sentence explaining the service, target customer, and result."},
            {"issue": "The content lacks answers to common user questions.",
             "recommendation": "Add a short FAQ covering process, expected outcomes, limitations, and next steps."},
        ],
        "faq": [
            {"question": "What does the SEO analysis check?", "answer": "It checks content, page structure, technical signals, links, and AI-readiness indicators."},
            {"question": "Does optimization guarantee a top ranking?", "answer": "No. It improves important signals, but rankings depend on competition, quality, authority, and search-platform changes."},
        ],
        "improved_content": "Make the main service and user benefit clear in the first paragraph. Organize the page with descriptive headings, explain the process, and add useful evidence and FAQs without making unsupported claims.",
    }


def normalize_ai_result(raw, original_content, keyword):
    text = raw.strip() if isinstance(raw, str) else json.dumps(raw)
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I | re.S).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = {"content_score": None, "primary_keyword": keyword, "secondary_keywords": [],
                "meta_title": "", "meta_description": "", "issues": [], "faq": [],
                "improved_content": text}
    defaults = {"content_score": None, "primary_keyword": keyword, "secondary_keywords": [],
                "meta_title": "", "meta_description": "", "issues": [], "faq": [],
                "improved_content": original_content}
    defaults.update(data if isinstance(data, dict) else {})
    if isinstance(defaults["content_score"], (int, float)):
        defaults["content_score"] = max(0, min(100, round(defaults["content_score"])))
    return defaults


def friendly_error(exc):
    if isinstance(exc, requests.Timeout):
        return "The provider took too long to respond. Try again or switch provider."
    if isinstance(exc, requests.HTTPError):
        status = exc.response.status_code if exc.response is not None else 0
        mapping = {400: "The provider rejected the request or model name.",
                   401: "The API key could not be authenticated.",
                   403: "The API key does not have permission for this model.",
                   404: "The selected model or endpoint was not found.",
                   429: "The free quota or rate limit was reached.",
                   500: "The provider had a temporary server problem.",
                   503: "The provider or model is temporarily unavailable."}
        return mapping.get(status, f"The external service returned HTTP {status}.")
    return str(exc)[:250]


app = create_app()

# ============================================================
# YUNNHENG'S PAGES
# ============================================================

@app.route('/privacy')
def privacy():
    return render_template('privacy.html')

@app.route('/terms')
def terms():
    return render_template('terms.html')

@app.route('/contact', methods=['GET', 'POST'])
def contact():
    return render_template('contact.html')

@app.route('/builder', methods=['GET', 'POST'])
def builder():
    return render_template('builder.html')
    
if __name__ == "__main__":
    app.run(debug=True)
