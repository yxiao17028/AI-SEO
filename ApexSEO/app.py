import os
import requests
from flask import Flask, request, redirect, session, jsonify, render_template
from dotenv import load_dotenv
import json
import datetime
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from html.parser import HTMLParser

# Allow insecure HTTP for local OAuth debugging
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'
# Allow scope changes without raising exception
os.environ['OAUTHLIB_RELAX_TOKEN_SCOPE'] = '1'

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "semrush_lite_secret_session_key_192837")

# Read configuration from environment variables
CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI")
SERP_API_KEY = os.getenv("SERP_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# GSC Read-only permission Scope
SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly']

def get_client_config():
    return {
        "web": {
            "client_id": CLIENT_ID,
            "project_id": "semrush-lite",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_secret": CLIENT_SECRET,
            "redirect_uris": [REDIRECT_URI]
        }
    }

def get_credentials():
    if 'credentials' not in session:
        return None
    creds_data = json.loads(session['credentials'])
    return Credentials(
        token=creds_data.get('token'),
        refresh_token=creds_data.get('refresh_token'),
        token_uri=creds_data.get('token_uri'),
        client_id=creds_data.get('client_id'),
        client_secret=creds_data.get('client_secret'),
        scopes=creds_data.get('scopes')
    )

# --- Page Routes ---

@app.route('/')
def index():
    return render_template('index.html')

# --- Google OAuth Routes ---

@app.route('/auth/google')
def auth_google():
    flow = Flow.from_client_config(
        get_client_config(),
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI
    )
    authorization_url, state = flow.authorization_url(
        access_type='offline',
        include_granted_scopes='true',
        prompt='consent'
    )
    session['state'] = state
    return redirect(authorization_url)

@app.route('/auth/google/callback')
def auth_google_callback():
    flow = Flow.from_client_config(
        get_client_config(),
        scopes=SCOPES,
        state=session.get('state'),
        redirect_uri=REDIRECT_URI
    )
    flow.fetch_token(authorization_response=request.url)
    
    credentials = flow.credentials
    session['credentials'] = json.dumps({
        'token': credentials.token,
        'refresh_token': credentials.refresh_token,
        'token_uri': credentials.token_uri,
        'client_id': credentials.client_id,
        'client_secret': credentials.client_secret,
        'scopes': credentials.scopes
    })
    return redirect('/')

@app.route('/api/auth/status')
def auth_status():
    creds = get_credentials()
    if creds and creds.valid:
        return jsonify({"authenticated": True})
    return jsonify({"authenticated": False})

@app.route('/api/auth/logout')
def auth_logout():
    session.pop('credentials', None)
    return jsonify({"success": True})

# --- Google Search Console API Endpoints ---

@app.route('/api/gsc/sites')
def gsc_sites():
    creds = get_credentials()
    if not creds:
        return jsonify({"error": "Unauthorized"}), 401
    
    try:
        service = build('searchconsole', 'v1', credentials=creds)
        site_list = service.sites().list().execute()
        return jsonify(site_list)
    except HttpError as error:
        return jsonify({"error": str(error)}), 500

@app.route('/api/gsc/report')
def gsc_report():
    creds = get_credentials()
    if not creds:
        return jsonify({"error": "Unauthorized"}), 401
    
    site_url = request.args.get('site_url')
    if not site_url:
        return jsonify({"error": "site_url parameter is required"}), 400
    
    # Default to fetching data for the last 30 days
    end_date = datetime.date.today() - datetime.timedelta(days=3) # GSC data typically has a 2-3 day delay
    start_date = end_date - datetime.timedelta(days=30)
    
    try:
        service = build('searchconsole', 'v1', credentials=creds)
        
        # 1. Trend request (grouped by date)
        trend_payload = {
            'startDate': start_date.strftime('%Y-%m-%d'),
            'endDate': end_date.strftime('%Y-%m-%d'),
            'dimensions': ['date'],
            'rowLimit': 100
        }
        trend_response = service.searchanalytics().query(siteUrl=site_url, body=trend_payload).execute()
        
        # 2. Keyword details request (grouped by query)
        query_payload = {
            'startDate': start_date.strftime('%Y-%m-%d'),
            'endDate': end_date.strftime('%Y-%m-%d'),
            'dimensions': ['query'],
            'rowLimit': 50
        }
        query_response = service.searchanalytics().query(siteUrl=site_url, body=query_payload).execute()
        
        # 3. Page details request (grouped by page)
        page_payload = {
            'startDate': start_date.strftime('%Y-%m-%d'),
            'endDate': end_date.strftime('%Y-%m-%d'),
            'dimensions': ['page'],
            'rowLimit': 50
        }
        page_response = service.searchanalytics().query(siteUrl=site_url, body=page_payload).execute()

        return jsonify({
            "trend": trend_response.get("rows", []),
            "queries": query_response.get("rows", []),
            "pages": page_response.get("rows", [])
        })
    except HttpError as error:
        return jsonify({"error": str(error)}), 500

# --- SerpApi Endpoints ---

@app.route('/api/serp/track')
def serp_track():
    keyword = request.args.get('keyword')
    domain = request.args.get('domain')
    
    if not keyword or not domain:
        return jsonify({"error": "keyword and domain parameters are required"}), 400
    
    if not SERP_API_KEY:
        return jsonify({"error": "SerpApi key is missing on server"}), 500

    url = "https://serpapi.com/search"
    params = {
        "engine": "google",
        "q": keyword,
        "location": "United States",
        "google_domain": "google.com",
        "gl": "us",
        "hl": "en",
        "api_key": SERP_API_KEY
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        data = response.json()
        
        organic_results = data.get("organic_results", [])
        ads = data.get("ads", [])
        related_searches = data.get("related_searches", [])
        people_also_ask = data.get("people_also_ask", [])
        
        # Locate rank
        rank = -1
        target_url = ""
        for item in organic_results:
            link = item.get("link", "")
            if domain.lower() in link.lower():
                rank = item.get("position")
                target_url = link
                break
                
        return jsonify({
            "rank": rank,
            "target_url": target_url,
            "organic_results": organic_results[:10], # Only return the top 10 results
            "ads": ads,
            "related_searches": related_searches[:5],
            "people_also_ask": people_also_ask[:5]
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- Gemini API AI SEO Endpoints ---

def call_gemini(prompt):
    if not GEMINI_API_KEY:
        return "Error: GEMINI_API_KEY is not configured."
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key={GEMINI_API_KEY}"
    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [{
            "parts": [{
                "text": prompt
            }]
        }]
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=15)
        res_data = response.json()
        text_res = res_data['candidates'][0]['content']['parts'][0]['text']
        return text_res
    except Exception as e:
        return f"Error calling Gemini API: {str(e)}"

@app.route('/api/ai/intent', methods=['POST'])
def ai_intent():
    req_data = request.json or {}
    keywords = req_data.get('keywords', [])
    if not keywords:
        return jsonify({"error": "keywords list is required"}), 400
    
    prompt = f"""
    You are a professional SEO expert. Please classify the search intent for the following keywords.
    Classification criteria:
    - Informational: Searching for knowledge, answers, guides (e.g., how to learn programming)
    - Commercial: Investigating products, services, brands in preparation for a purchase (e.g., best running shoe brands)
    - Transactional: Clear intent to purchase or complete an action (e.g., buy Nike running shoes discount, sign up for account)
    - Navigational: Searching for a specific website or webpage (e.g., Facebook login)

    Please output directly in JSON format. Do not wrap it in Markdown (like ```json), just output a valid JSON Array. Format like:
    [
      {{"keyword": "keyword1", "intent": "Informational", "reason": "explanation of reason"}},
      {{"keyword": "keyword2", "intent": "Transactional", "reason": "explanation of reason"}}
    ]

    Keywords list: {json.dumps(keywords, ensure_ascii=False)}
    """
    
    result_text = call_gemini(prompt)
    
    # Clean possible markdown wrapping
    clean_text = result_text.replace("```json", "").replace("```", "").strip()
    try:
        parsed_json = json.loads(clean_text)
        return jsonify(parsed_json)
    except Exception:
        return jsonify({"raw_response": result_text})

@app.route('/api/ai/brief', methods=['POST'])
def ai_brief():
    req_data = request.json or {}
    keyword = req_data.get('keyword')
    serp_titles = req_data.get('serp_titles', [])
    
    if not keyword:
        return jsonify({"error": "keyword is required"}), 400
        
    titles_str = "\n".join([f"- {t}" for t in serp_titles])
    
    prompt = f"""
    As an SEO Content Architect, please generate a deeply optimized writing outline and content analysis (Content Brief) for the core keyword "{keyword}".
    Referenced web page titles from top competitors on Google:
    {titles_str}

    Please output a beautifully formatted Markdown report containing the following sections:
    1. Title Suggestions: Provide 3 high-attraction, keyword-rich titles (H1)
    2. Article Outline: Provide a logical writing structure containing H2 and H3 headers
    3. Recommended Keywords: List 8-10 semantically related terms that must be covered in the writing
    4. Competitor Analysis & Recommendations: Analyze the angle of the competitors, explaining how we can create content differentiation (Content Gap) to outperform them.
    """
    
    result_text = call_gemini(prompt)
    return jsonify({"brief": result_text})

@app.route('/api/ai/optimize_meta', methods=['POST'])
def ai_optimize():
    req_data = request.json or {}
    page_url = req_data.get('url', 'example.com/page')
    current_title = req_data.get('title', '')
    current_desc = req_data.get('description', '')
    topic = req_data.get('topic', 'Product Introduction')

    prompt = f"""
    You are an SEO expert. We need to optimize the Meta tags for a web page to improve its Click-Through Rate (CTR) in Google search results.
    
    Web page URL: {page_url}
    Core Topic/Keyword: {topic}
    Current Title: {current_title}
    Current Description: {current_desc}

    Please return the following information directly in JSON format. Do not wrap it in ```json tags, just output valid JSON:
    {{
      "optimized_title": "Optimized Title (within 60 characters, containing the core keyword, highly attractive)",
      "optimized_description": "Optimized Description (within 150 characters, containing a Call to Action to drive clicks)",
      "optimizations_explanation": "Briefly explain the optimization logic and rationale behind the changes"
    }}
    """
    
    result_text = call_gemini(prompt)
    clean_text = result_text.replace("```json", "").replace("```", "").strip()
    try:
        parsed_json = json.loads(clean_text)
        return jsonify(parsed_json)
    except Exception:
        return jsonify({"raw_response": result_text})

class SEOMetadataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self.description = ""
        self.in_title = False
        self.h1_count = 0
        self.h2_count = 0
        self.h3_count = 0
        self.images_count = 0
        self.images_with_alt = 0
        self.has_viewport = False
        self.links = []
        self.social_links = {
            "youtube": False,
            "x": False,
            "linkedin": False,
            "facebook": False,
            "instagram": False
        }

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        tag = tag.lower()
        if tag == "title":
            self.in_title = True
        elif tag == "meta":
            name = attrs_dict.get("name", "").lower()
            property = attrs_dict.get("property", "").lower()
            if name == "description" or property == "og:description":
                self.description = attrs_dict.get("content", "")
            elif name == "viewport":
                self.has_viewport = True
        elif tag == "h1":
            self.h1_count += 1
        elif tag == "h2":
            self.h2_count += 1
        elif tag == "h3":
            self.h3_count += 1
        elif tag == "img":
            self.images_count += 1
            if "alt" in attrs_dict and attrs_dict["alt"].strip():
                self.images_with_alt += 1
        elif tag == "a":
            href = attrs_dict.get("href", "")
            if href:
                self.links.append(href)
                href_lower = href.lower()
                if "youtube.com" in href_lower or "youtu.be" in href_lower:
                    self.social_links["youtube"] = True
                if "x.com" in href_lower or "twitter.com" in href_lower:
                    self.social_links["x"] = True
                if "linkedin.com" in href_lower:
                    self.social_links["linkedin"] = True
                if "facebook.com" in href_lower:
                    self.social_links["facebook"] = True
                if "instagram.com" in href_lower:
                    self.social_links["instagram"] = True

    def handle_endtag(self, tag):
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data

@app.route('/api/keyword/check')
def keyword_check():
    keyword = request.args.get('keyword')
    if not keyword:
        return jsonify({"error": "keyword parameter is required"}), 400
        
    if not SERP_API_KEY:
        return jsonify({"error": "SerpApi key is missing on server"}), 500

    url = "https://serpapi.com/search"
    params = {
        "engine": "google",
        "q": keyword,
        "location": "United States",
        "google_domain": "google.com",
        "gl": "us",
        "hl": "en",
        "api_key": SERP_API_KEY
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        data = response.json()
        
        organic_results = data.get("organic_results", [])
        ads = data.get("ads", [])
        
        competitors = [{"title": item.get("title"), "link": item.get("link"), "snippet": item.get("snippet")} for item in organic_results[:5]]
        ads_info = [{"title": ad.get("title"), "link": ad.get("displayed_link")} for ad in ads[:3]]
        
        prompt = f"""
        You are a professional SEO analyzer. For the core keyword "{keyword}", analyze the following search engine results page (SERP) data:
        Competitors: {json.dumps(competitors, ensure_ascii=False)}
        Ads: {json.dumps(ads_info, ensure_ascii=False)}

        Based on this SERP data, estimate:
        1. Monthly Search Volume: Typical monthly search volume in the US (estimate a realistic volume, e.g. 201000).
        2. Global Search Volume: Estimated global search volume (larger than US volume).
        3. Global Search Volume Split: Volumes for the top 5 countries (US, IN, UK, AU, CA, etc.) and 'Other'. Provide country names, 2-letter codes, estimated volumes, and percentages.
        4. Keyword Difficulty: A percentage between 1% and 100% and a difficulty level ("Easy", "Medium", "Hard"). Higher if top results contain domain names like Apple, Nike, Wikipedia, Amazon, or have many ads.
        5. Search Intent: "Informational", "Commercial", "Transactional", or "Navigational".
        6. Cost-Per-Click (CPC) in USD: Estimated search CPC.

        Please return the results directly in JSON format. Do not wrap in ```json tags. Just output a valid JSON object matching this schema exactly:
        {{
          "keyword": "{keyword}",
          "monthly_volume": 201000,
          "global_volume": 592700,
          "global_split": [
            {{"country": "United States", "code": "US", "volume": 201000, "percentage": 34}},
            {{"country": "India", "code": "IN", "volume": 110000, "percentage": 18}},
            ...
          ],
          "difficulty": 72,
          "difficulty_level": "Hard",
          "intent": "Commercial",
          "cpc": 0.97
        }}
        """
        
        result_text = call_gemini(prompt)
        clean_text = result_text.replace("```json", "").replace("```", "").strip()
        parsed_json = json.loads(clean_text)
        return jsonify(parsed_json)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/keyword/magic')
def keyword_magic():
    keyword = request.args.get('keyword')
    if not keyword:
        return jsonify({"error": "keyword parameter is required"}), 400
        
    if not SERP_API_KEY:
        return jsonify({"error": "SerpApi key is missing on server"}), 500

    url = "https://serpapi.com/search"
    params = {
        "engine": "google",
        "q": keyword,
        "location": "United States",
        "google_domain": "google.com",
        "gl": "us",
        "hl": "en",
        "api_key": SERP_API_KEY
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        data = response.json()
        
        related_searches = [r.get("query") for r in data.get("related_searches", [])]
        
        prompt = f"""
        You are an SEO Keyword Magic Tool. For the seed keyword "{keyword}", generate a list of 10-15 related keyword variations.
        Here are some real-world related search terms: {json.dumps(related_searches, ensure_ascii=False)}

        For each keyword variation in the list, provide:
        1. Keyword string.
        2. Search Intent: Choose from "Informational", "Commercial", "Transactional", "Navigational".
        3. Search Volume: Realistic monthly search volume.
        4. Keyword Difficulty (KD %): A percentage (1 to 100).
        5. CPC (USD): Estimated cost-per-click in USD.

        Please return the results directly in JSON format. Do not wrap in ```json tags. Just output a valid JSON array of objects matching this schema exactly:
        [
          {{
            "keyword": "related keyword 1",
            "intent": "Commercial",
            "volume": 390,
            "difficulty": 77,
            "cpc": 1.16
          }},
          ...
        ]
        """
        
        result_text = call_gemini(prompt)
        clean_text = result_text.replace("```json", "").replace("```", "").strip()
        parsed_json = json.loads(clean_text)
        return jsonify(parsed_json)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/audit')
def audit_website():
    url = request.args.get('url')
    if not url:
        return jsonify({"error": "url parameter is required"}), 400
        
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
        res = requests.get(url, headers=headers, timeout=12)
        
        parser = SEOMetadataParser()
        parser.feed(res.text)
        
        page_size_kb = round(len(res.content) / 1024, 2)
        ssl_enabled = url.startswith("https://")
        
        meta_summary = {
            "url": url,
            "title": parser.title.strip(),
            "title_length": len(parser.title.strip()),
            "description": parser.description.strip(),
            "description_length": len(parser.description.strip()),
            "h1_count": parser.h1_count,
            "h2_count": parser.h2_count,
            "h3_count": parser.h3_count,
            "images_count": parser.images_count,
            "images_with_alt": parser.images_with_alt,
            "has_viewport": parser.has_viewport,
            "page_size_kb": page_size_kb,
            "ssl_enabled": ssl_enabled,
            "social_links": parser.social_links
        }
        
        prompt = f"""
        You are an expert SEO auditor. Analyze the following webpage crawl summary metadata:
        {json.dumps(meta_summary, ensure_ascii=False)}

        Perform an SEO health audit and output:
        1. On-Page SEO score (0-100)
        2. Technical SEO score (0-100)
        3. Off-Page SEO score (0-100)
        4. Social Media score (0-100)
        5. Overall SEO score (weighted average of the above)
        6. A comprehensive list of individual SEO checks/issues with statuses ("success", "warning", or "error"), check names, and recommended details/next steps.
           Ensure you check:
           - Title Tag (success if 30-65 chars, warning if too long/short, error if empty)
           - Meta Description (success if 100-160 chars, warning if too long/short, error if empty)
           - H1 Heading (success if exactly 1, warning/error otherwise)
           - Viewport Tag / Mobile Friendliness (success if has_viewport is true, error otherwise)
           - Image Alt Tags (success if all have alt, warning if some are missing, error if many missing)
           - SSL/HTTPS security (success if ssl_enabled, error if http)
           - Social links presence (YouTube, X/Twitter, LinkedIn, Facebook, Instagram)

        Please return the results directly in JSON format. Do not wrap in ```json tags. Just output a valid JSON object matching this schema exactly:
        {{
          "url": "{url}",
          "seo_score": 78,
          "scores": {{
            "on_page": 85,
            "technical": 90,
            "off_page": 50,
            "social": 60
          }},
          "issues": [
            {{
              "type": "On-Page SEO",
              "check": "Title Tag",
              "status": "success",
              "details": "Title length is 54 characters which is optimal."
            }},
            {{
              "type": "Page Speed",
              "check": "DOM Size",
              "status": "warning",
              "details": "Page size is 120KB, which is fair but can be optimized."
            }}
          ]
        }}
        """
        
        result_text = call_gemini(prompt)
        clean_text = result_text.replace("```json", "").replace("```", "").strip()
        parsed_json = json.loads(clean_text)
        return jsonify(parsed_json)
        
    except Exception as e:
        return jsonify({"error": f"Failed to audit website: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
