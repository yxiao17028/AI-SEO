import io
import json
import os
import re
import secrets
import zipfile
from datetime import datetime
from functools import wraps
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from flask import Flask, flash, jsonify, redirect, render_template, request, session, url_for, send_file
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
    "openai": {
        "name": "OpenAI",
        "type": "openai_compatible",
        "base_url": "https://api.openai.com/v1/chat/completions",
        "default_model": "gpt-4.1-mini",
        "note": "Use a model available to your OpenAI account.",
    },
    "anthropic": {
        "name": "Anthropic Claude",
        "type": "anthropic",
        "base_url": "https://api.anthropic.com/v1/messages",
        "default_model": "claude-3-5-haiku-latest",
        "note": "Requires an Anthropic API key and available model.",
    },
    "mistral": {
        "name": "Mistral AI",
        "type": "openai_compatible",
        "base_url": "https://api.mistral.ai/v1/chat/completions",
        "default_model": "mistral-small-latest",
        "note": "Uses an OpenAI-compatible request format.",
    },
    "custom": {
        "name": "Custom OpenAI-Compatible API",
        "type": "openai_compatible",
        "base_url": "",
        "default_model": "",
        "note": "Enter a compatible endpoint and model ID.",
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

class GeneratedSite(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    payload = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class ContactMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)  # Nullable for non-logged-in users
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(160), nullable=False)
    subject = db.Column(db.String(200), nullable=False)
    message = db.Column(db.Text, nullable=False)
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
        analytics = build_demo_analytics(websites, analyses)
        category_totals = audit_category_totals(analyses)
        return render_template("dashboard.html", websites=websites, analyses=analyses,
                               ai_results=ai_results, average=average, analytics=analytics,
                               category_totals=category_totals)

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
            if provider_id == "custom":
                config = dict(config)
                config["base_url"] = request.form.get("base_url", "").strip()
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
            if provider_id == "custom":
                config = dict(config)
                config["base_url"] = str(data.get("base_url", "")).strip()
            call_provider(config, data.get("api_key", ""), data.get("model") or config["default_model"],
                          "Reply only with OK.", app.config["REQUEST_TIMEOUT"])
            return jsonify(success=True, message="Connection successful.")
        except Exception as exc:
            return jsonify(success=False, message=friendly_error(exc)), 400

    @app.get("/api/providers")
    def provider_list():
        return jsonify({key: {k: v for k, v in cfg.items() if k != "base_url"}
                        for key, cfg in PROVIDERS.items()})
   
    @app.route("/builder", methods=["GET", "POST"])
    @login_required
    def builder():
        generated = None
        if request.method == "POST":
            site_name = request.form.get("site_name", "Optimized Business").strip() or "Optimized Business"
            industry = request.form.get("industry", "Professional Services").strip()
            audience = request.form.get("audience", "Customers in Malaysia").strip()
            keyword = request.form.get("keyword", "trusted services Malaysia").strip()
            description = request.form.get("description", "").strip()
            theme = request.form.get("theme", "violet")
            package = generate_site_package(site_name, industry, audience, keyword, description, theme)
            record = GeneratedSite(user_id=session["user_id"], name=site_name,
                                   payload=json.dumps(package, ensure_ascii=False))
            db.session.add(record)
            db.session.commit()
            generated = {**package, "id": record.id}
            flash("Optimized website preview generated.", "success")
        recent = GeneratedSite.query.filter_by(user_id=session["user_id"]).order_by(GeneratedSite.created_at.desc()).limit(5).all()
        return render_template("builder.html", generated=generated, recent=recent)

    @app.get("/builder/download/<int:site_id>")
    @login_required
    def download_site(site_id):
        record = GeneratedSite.query.filter_by(id=site_id, user_id=session["user_id"]).first_or_404()
        package = json.loads(record.payload)
        memory = io.BytesIO()
        with zipfile.ZipFile(memory, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("frontend/index.html", package["html"])
            archive.writestr("frontend/styles.css", package["css"])
            archive.writestr("frontend/script.js", package["js"])
            archive.writestr("backend/app.py", package["backend"])
            archive.writestr("backend/requirements.txt", "Flask==3.1.1\nFlask-SQLAlchemy==3.1.1\n")
            archive.writestr("database/schema.sql", package["schema"])
            archive.writestr("README.md", package["readme"])
            archive.writestr(".env.example", "SECRET_KEY=replace-me\nDATABASE_URL=sqlite:///website.db\n")
            archive.writestr("seo-report.json", json.dumps(package["seo"], indent=2))
        memory.seek(0)
        safe = re.sub(r"[^a-zA-Z0-9_-]+", "-", record.name).strip("-").lower() or "generated-site"
        return send_file(memory, as_attachment=True, download_name=f"{safe}-starter.zip", mimetype="application/zip")

    @app.get("/api/dashboard/analytics")
    @login_required
    def dashboard_analytics():
        websites = Website.query.filter_by(user_id=session["user_id"]).all()
        analyses = Analysis.query.join(Website).filter(Website.user_id == session["user_id"]).all()
        return jsonify(build_demo_analytics(websites, analyses))

    @app.route("/privacy")
    def privacy():
        return render_template("privacy.html")
    
    @app.route("/terms")
    def terms():
        return render_template("terms.html")

    @app.route("/contact", methods=["GET", "POST"])
    def contact():
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            email = request.form.get("email", "").strip()
            subject = request.form.get("subject", "").strip()
            message = request.form.get("message", "").strip()
            
            if not name or not email or not subject or not message:
                flash("All fields are required.", "error")
            else:
                msg = ContactMessage(
                    user_id=session.get("user_id"),
                    name=name,
                    email=email,
                    subject=subject,
                    message=message
                )
                db.session.add(msg)
                db.session.commit()
                flash("Your message has been sent. We'll respond shortly.", "success")
                return redirect(url_for("contact"))
        
        return render_template("contact.html")

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
    if config["type"] == "anthropic":
        headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
        payload = {"model": model, "max_tokens": 2500, "temperature": 0.2,
                   "messages": [{"role": "user", "content": prompt}]}
        response = requests.post(config["base_url"], headers=headers, json=payload, timeout=timeout)
        response.raise_for_status()
        return response.json()["content"][0]["text"]
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


def audit_category_totals(analyses):
    totals = {}
    for analysis in analyses:
        try:
            data = json.loads(analysis.payload)
        except Exception:
            continue
        for check in data.get("checks", []):
            category = check.get("category", "Other")
            bucket = totals.setdefault(category, {"passed": 0, "warning": 0, "critical": 0})
            status = check.get("status", "warning")
            bucket[status] = bucket.get(status, 0) + 1
    return totals


def build_demo_analytics(websites, analyses):
    # Demonstration analytics are deterministic and clearly labelled in the UI.
    base = max(1, len(websites))
    audit_factor = max(1, len(analyses))
    labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    visitors = [base * n + audit_factor * 2 for n in (24, 31, 29, 38, 46, 41, 53)]
    clicks = [round(v * 0.34) for v in visitors]
    return {
        "mode": "demo",
        "labels": labels,
        "visitors": visitors,
        "clicks": clicks,
        "page_views": sum(visitors) * 2,
        "total_visitors": sum(visitors),
        "search_clicks": sum(clicks),
        "ctr": round(sum(clicks) / max(sum(visitors) * 3.1, 1) * 100, 1),
        "avg_position": 18.4,
        "sources": {"Organic Search": 48, "Direct": 25, "Social": 17, "Referral": 10},
        "devices": {"Mobile": 61, "Desktop": 34, "Tablet": 5},
        "locations": {"Malaysia": 67, "Singapore": 11, "Indonesia": 8, "Other": 14},
    }


def _extract_css_signals(soup):
    css_text = "\n".join(tag.get_text(" ", strip=True) for tag in soup.find_all("style"))
    inline = "\n".join(tag.get("style", "") for tag in soup.find_all(style=True))
    css = css_text + "\n" + inline
    colors = re.findall(r"(?:color|background(?:-color)?)\s*:\s*([^;}{]+)", css, re.I)
    fonts = re.findall(r"font-family\s*:\s*([^;}{]+)", css, re.I)
    sizes = re.findall(r"font-size\s*:\s*([0-9.]+)(px|rem|em)", css, re.I)
    animations = len(re.findall(r"(?:animation\s*:|@keyframes|transition\s*:)", css, re.I))
    small_px = sum(1 for value, unit in sizes if unit.lower() == "px" and float(value) < 14)
    return {
        "color_count": len(set(x.strip().lower() for x in colors)),
        "font_count": len(set(x.strip().lower() for x in fonts)),
        "font_sizes": len(sizes),
        "small_font_rules": small_px,
        "animation_signals": animations,
    }


def analyze_html(html, url, response_time):
    """Comprehensive static audit of the retrieved HTML and embedded/inline CSS."""
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
    html_lang = (soup.html or {}).get("lang", "") if soup.html else ""
    forms = soup.find_all("form")
    inputs = soup.find_all(["input", "select", "textarea"])
    labels = soup.find_all("label")
    buttons = soup.find_all(["button"])
    empty_links = sum(1 for a in soup.find_all("a") if not a.get_text(" ", strip=True) and not a.get("aria-label"))
    og_title = soup.find("meta", property="og:title")
    og_desc = soup.find("meta", property="og:description")
    skip_link = soup.find("a", href=re.compile(r"^#(?:main|content)", re.I))
    css = _extract_css_signals(soup)

    checks = []
    def add(category, title_text, status, points, max_points, finding, recommendation):
        checks.append({"category": category, "title": title_text, "status": status,
                       "points": points, "max_points": max_points,
                       "finding": finding, "recommendation": recommendation})

    add("Content SEO", "Page title", "passed" if 30 <= len(title) <= 60 else ("warning" if title else "critical"),
        10 if 30 <= len(title) <= 60 else (5 if title else 0), 10,
        f"Title length is {len(title)} characters." if title else "No page title was found.",
        "Use a unique, descriptive title of approximately 30–60 characters.")
    add("Content SEO", "Meta description", "passed" if 70 <= len(meta_desc) <= 160 else ("warning" if meta_desc else "critical"),
        10 if 70 <= len(meta_desc) <= 160 else (5 if meta_desc else 0), 10,
        f"Description length is {len(meta_desc)} characters." if meta_desc else "No meta description was found.",
        "Write a clear 70–160 character summary that matches search intent.")
    add("Structure", "Primary heading", "passed" if len(h1s) == 1 else ("warning" if len(h1s) > 1 else "critical"),
        10 if len(h1s) == 1 else (5 if h1s else 0), 10, f"{len(h1s)} H1 heading(s) were found.",
        "Use one clear H1 and organise subtopics with H2/H3 headings.")
    add("Structure", "Subheading structure", "passed" if h2s else "warning", 10 if h2s else 4, 10,
        f"{len(h2s)} H2 headings were found.", "Use descriptive H2 sections to improve scanning and AI comprehension.")
    ratio = missing_alt / len(images) if images else 0
    add("Accessibility", "Image alternative text", "passed" if ratio == 0 else ("critical" if ratio > .5 else "warning"),
        10 if ratio == 0 else (3 if ratio > .5 else 6), 10,
        f"{missing_alt} of {len(images)} images are missing alt text.", "Add meaningful alt text to informative images.")
    add("Technical SEO", "Mobile viewport", "passed" if viewport else "critical", 10 if viewport else 0, 10,
        "A mobile viewport tag was found." if viewport else "No mobile viewport tag was found.",
        "Add a responsive viewport meta tag.")
    add("Technical SEO", "Canonical URL", "passed" if canonical else "warning", 10 if canonical else 5, 10,
        "A canonical URL was found." if canonical else "No canonical URL was found.", "Add a canonical URL to reduce duplicate-page ambiguity.")
    add("Content SEO", "Content depth", "passed" if word_count >= 300 else ("warning" if word_count >= 120 else "critical"),
        10 if word_count >= 300 else (6 if word_count >= 120 else 2), 10,
        f"Approximately {word_count} words were detected.", "Add original, useful details and direct answers to common questions.")
    add("Navigation", "Internal links", "passed" if internal_links >= 2 else "warning", 10 if internal_links >= 2 else 5, 10,
        f"{internal_links} internal links were detected.", "Use descriptive links to relevant supporting pages.")
    add("AI Readiness", "Structured data", "passed" if json_ld else "warning", 10 if json_ld else 4, 10,
        f"{len(json_ld)} JSON-LD block(s) were detected.", "Add valid schema markup that matches the business and page type.")
    add("Social Discovery", "Open Graph metadata", "passed" if og_title and og_desc else "warning", 8 if og_title and og_desc else 3, 8,
        "Open Graph title and description are present." if og_title and og_desc else "Open Graph title or description is missing.",
        "Add Open Graph metadata for clearer social sharing previews.")
    add("Accessibility", "Document language", "passed" if html_lang else "warning", 6 if html_lang else 2, 6,
        f"Document language is set to '{html_lang}'." if html_lang else "The HTML language attribute is missing.",
        "Set the lang attribute on the HTML element.")
    unlabeled = max(0, len(inputs) - len(labels))
    add("Accessibility", "Form labelling", "passed" if not inputs or unlabeled == 0 else "warning", 8 if not inputs or unlabeled == 0 else 4, 8,
        f"{len(inputs)} form controls and {len(labels)} labels were detected.", "Associate every form control with a visible label or accessible name.")
    add("Accessibility", "Link names", "passed" if empty_links == 0 else "warning", 6 if empty_links == 0 else 3, 6,
        f"{empty_links} links may lack an accessible name.", "Give icon-only links an aria-label or visible text.")
    add("Accessibility", "Skip navigation", "passed" if skip_link else "warning", 5 if skip_link else 2, 5,
        "A skip-to-content link was found." if skip_link else "No skip-to-content link was detected.",
        "Add a keyboard-accessible skip link for repeated navigation.")
    add("Visual Design", "Typography consistency", "passed" if css["font_count"] <= 3 else "warning", 8 if css["font_count"] <= 3 else 4, 8,
        f"Approximately {css['font_count']} font-family definitions were detected.", "Limit the design to a small, consistent typography system.")
    add("Visual Design", "Readable font sizes", "passed" if css["small_font_rules"] == 0 else "warning", 8 if css["small_font_rules"] == 0 else 4, 8,
        f"{css['small_font_rules']} CSS rules use font sizes below 14px.", "Avoid very small body text and test readability on mobile devices.")
    add("Visual Design", "Colour system", "passed" if css["color_count"] <= 12 else "warning", 8 if css["color_count"] <= 12 else 4, 8,
        f"Approximately {css['color_count']} colour declarations were detected.", "Use a controlled colour palette and verify WCAG contrast in rendered pages.")
    add("Motion & UX", "Animation usage", "passed" if css["animation_signals"] <= 8 else "warning", 7 if css["animation_signals"] <= 8 else 3, 7,
        f"{css['animation_signals']} animation or transition signals were detected.", "Keep motion purposeful and support prefers-reduced-motion.")
    if response_time <= 1500: status, pts = "passed", 10
    elif response_time <= 3000: status, pts = "warning", 6
    else: status, pts = "critical", 2
    add("Performance", "HTML response time", status, pts, 10, f"The HTML response took about {response_time} ms.",
        "Improve hosting, caching, and server processing. Use Lighthouse for full Core Web Vitals.")

    total = sum(c["points"] for c in checks); maximum = sum(c["max_points"] for c in checks)
    summary = {k: sum(c["status"] == k for c in checks) for k in ("passed", "warning", "critical")}
    summary["warnings"] = summary["warning"]
    categories = {}
    for c in checks:
        x = categories.setdefault(c["category"], {"points": 0, "maximum": 0})
        x["points"] += c["points"]; x["maximum"] += c["max_points"]
    category_scores = {k: round(v["points"] / v["maximum"] * 100) for k, v in categories.items()}
    return {"url": url, "score": round(total / maximum * 100), "summary": summary, "checks": checks,
            "category_scores": category_scores,
            "page": {"title": title, "meta_description": meta_desc, "h1": h1s, "word_count": word_count,
                     "images": len(images), "internal_links": internal_links, "response_time_ms": response_time,
                     "forms": len(forms), "buttons": len(buttons), "css_signals": css}}


def generate_site_package(site_name, industry, audience, keyword, description, theme):
    palettes = {
        "violet": ("#5b4df5", "#161a35", "#f5f6ff"),
        "emerald": ("#087f5b", "#102a24", "#f1fbf7"),
        "ocean": ("#0b6ea8", "#102638", "#f1f9fd"),
        "sunset": ("#d95d39", "#34201b", "#fff7f3"),
    }
    accent, ink, bg = palettes.get(theme, palettes["violet"])
    safe_desc = description or f"{site_name} provides reliable {industry.lower()} solutions designed for {audience.lower()}."
    meta = f"Discover {site_name}, a trusted choice for {keyword}. Clear services, practical guidance, and an accessible customer experience."
    html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{site_name} | {keyword.title()}</title><meta name="description" content="{meta[:155]}"><link rel="canonical" href="https://example.com/"><link rel="stylesheet" href="styles.css"><script type="application/ld+json">{{"@context":"https://schema.org","@type":"Organization","name":"{site_name}"}}</script></head><body><a class="skip" href="#main">Skip to content</a><header><nav aria-label="Primary"><strong>{site_name}</strong><div><a href="#services">Services</a><a href="#about">About</a><a class="button" href="#contact">Contact</a></div></nav></header><main id="main"><section class="hero"><div><p class="eyebrow">{industry}</p><h1>{keyword.title()} designed around real customer needs</h1><p>{safe_desc}</p><div class="actions"><a class="button" href="#contact">Get started</a><a class="secondary" href="#services">Explore services</a></div></div><aside><span>Website readiness</span><strong>92/100</strong><p>Responsive, accessible and search-friendly starter design.</p></aside></section><section id="services"><p class="eyebrow">What we offer</p><h2>Clear solutions for {audience}</h2><div class="cards"><article><h3>Focused service</h3><p>Describe the main service using direct language and evidence.</p></article><article><h3>Helpful guidance</h3><p>Answer common questions before visitors need to ask.</p></article><article><h3>Easy next step</h3><p>Use visible, accessible calls to action on every device.</p></article></div></section><section id="about" class="split"><div><p class="eyebrow">Why choose us</p><h2>Useful information, not unsupported promises</h2><p>Explain experience, process and customer value in a way that users and AI search systems can understand.</p></div><ul><li>Clear heading hierarchy</li><li>Readable typography and contrast</li><li>Structured organisation data</li><li>Mobile-first layout</li></ul></section><section class="faq"><p class="eyebrow">FAQ</p><h2>Common questions</h2><details><summary>Who is this service for?</summary><p>It is designed for {audience.lower()}.</p></details><details><summary>How do I begin?</summary><p>Contact the team with your goal and preferred timeline.</p></details></section><section id="contact" class="contact"><h2>Ready to discuss your goals?</h2><p>Tell us what you need and receive a clear next step.</p><a class="button light" href="mailto:hello@example.com">Contact {site_name}</a></section></main><footer><span>© 2026 {site_name}</span><a href="#main">Back to top</a></footer><script src="script.js"></script></body></html>'''
    css = f''':root{{--accent:{accent};--ink:{ink};--bg:{bg};--panel:#fff;--muted:#667085;--line:#e5e7ef}}*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}body{{margin:0;font:16px/1.65 Inter,system-ui,sans-serif;color:var(--ink);background:var(--bg)}}a{{color:inherit}}.skip{{position:absolute;left:-9999px}}.skip:focus{{left:16px;top:16px;background:#fff;padding:10px;z-index:9}}header,main,footer{{width:min(1120px,calc(100% - 40px));margin:auto}}nav{{height:76px;display:flex;align-items:center;justify-content:space-between}}nav div{{display:flex;gap:22px;align-items:center}}nav a{{text-decoration:none}}.button{{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:750}}.hero{{min-height:620px;display:grid;grid-template-columns:1.25fr .75fr;gap:60px;align-items:center}}h1{{font-size:clamp(2.6rem,6vw,5rem);line-height:1.02;letter-spacing:-.045em;margin:.3em 0}}h2{{font-size:clamp(2rem,4vw,3.2rem);line-height:1.12}}h3{{font-size:1.2rem}}p{{max-width:68ch}}.eyebrow{{text-transform:uppercase;letter-spacing:.14em;font-size:.78rem;font-weight:800;color:var(--accent)}}.hero>aside{{background:var(--panel);padding:32px;border-radius:24px;box-shadow:0 22px 60px #17213a18}}.hero>aside strong{{display:block;font-size:3.5rem;color:var(--accent)}}.actions{{display:flex;gap:14px;margin-top:28px}}.secondary{{padding:11px 18px;border:1px solid var(--line);border-radius:10px;text-decoration:none}}section{{padding:80px 0}}.cards{{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}}.cards article,.split,.faq details{{background:#fff;border:1px solid var(--line);border-radius:16px;padding:24px}}.split{{display:grid;grid-template-columns:1fr 1fr;gap:40px}}.split li{{margin:10px 0}}.faq details{{margin:12px 0}}summary{{font-weight:750;cursor:pointer}}.contact{{background:var(--ink);color:#fff;border-radius:28px;padding:56px;margin-bottom:70px}}.light{{background:#fff;color:var(--ink)}}footer{{display:flex;justify-content:space-between;padding:30px 0;border-top:1px solid var(--line)}}@media(max-width:760px){{nav div a:not(.button){{display:none}}.hero,.split{{grid-template-columns:1fr}}.hero{{padding:70px 0}}.cards{{grid-template-columns:1fr}}section{{padding:55px 0}}}}@media(prefers-reduced-motion:reduce){{html{{scroll-behavior:auto}}*,*::before,*::after{{animation-duration:.01ms!important;transition-duration:.01ms!important}}}}'''
    js = "document.querySelectorAll('details').forEach(x=>x.addEventListener('toggle',()=>{if(x.open)document.querySelectorAll('details').forEach(y=>{if(y!==x)y.open=false})}));"
    backend = '''from flask import Flask, jsonify, request, send_from_directory\nfrom flask_sqlalchemy import SQLAlchemy\napp=Flask(__name__,static_folder='../frontend',static_url_path='')\napp.config['SQLALCHEMY_DATABASE_URI']='sqlite:///website.db'\ndb=SQLAlchemy(app)\nclass Enquiry(db.Model):\n id=db.Column(db.Integer,primary_key=True); name=db.Column(db.String(100)); email=db.Column(db.String(160)); message=db.Column(db.Text)\n@app.get('/')\ndef index(): return send_from_directory(app.static_folder,'index.html')\n@app.post('/api/enquiries')\ndef enquiry():\n data=request.get_json() or {}; db.session.add(Enquiry(name=data.get('name',''),email=data.get('email',''),message=data.get('message',''))); db.session.commit(); return jsonify(success=True),201\nwith app.app_context(): db.create_all()\nif __name__=='__main__': app.run(debug=True)\n'''
    schema = "CREATE TABLE enquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(100), email VARCHAR(160), message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);\n"
    readme = f"# {site_name} generated starter\n\nThis package contains a responsive frontend plus an optional Flask/SQLite enquiry starter. Review all generated copy, branding, legal content and security before deployment.\n\n## Frontend\nOpen `frontend/index.html`.\n\n## Backend\nCreate a virtual environment, install `backend/requirements.txt`, then run `python backend/app.py`.\n"
    return {"html": html, "css": css, "js": js, "backend": backend, "schema": schema, "readme": readme,
            "seo": {"target_keyword": keyword, "meta_description": meta[:155], "structured_data": True, "mobile_responsive": True},
            "preview": html.replace('href="styles.css"', f'<style>{css}</style>').replace('<script src="script.js"></script>', f'<script>{js}</script>')}


app = create_app()

if __name__ == "__main__":
    app.run(debug=True)
