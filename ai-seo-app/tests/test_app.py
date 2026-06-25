import json
from app import analyze_html, create_app, db, normalize_ai_result

def test_analyzer_good_page():
    html='''<html><head><title>Professional SEO Services in Malaysia Today</title><meta name="description" content="A clear and practical description for a professional SEO service that helps Malaysian businesses improve online visibility and content discoverability."><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.com"><script type="application/ld+json">{}</script></head><body><h1>Professional SEO Services</h1><h2>What We Do</h2><p>''' + ('useful content ' * 180) + '''</p><img src="a.jpg" alt="SEO dashboard"><a href="/services">Services</a><a href="/about">About</a></body></html>'''
    result=analyze_html(html,'https://example.com',300)
    assert result['score'] >= 85
    assert result['summary']['critical'] == 0

def test_normalize_json_fence():
    result=normalize_ai_result('```json\n{"content_score": 88, "meta_title":"Test"}\n```','original','keyword')
    assert result['content_score']==88
    assert result['meta_title']=='Test'

def test_register_and_demo_ai(tmp_path):
    app=create_app({'TESTING':True,'SQLALCHEMY_DATABASE_URI':'sqlite:///' + str(tmp_path/'test.db'),'SECRET_KEY':'test'})
    client=app.test_client()
    r=client.post('/register',data={'name':'Test User','email':'test@example.com','password':'password123'},follow_redirects=True)
    assert r.status_code==200
    r=client.post('/ai',data={'provider':'demo','model':'local-demo','task':'content_optimization','content':'We provide SEO services.','keyword':'SEO services'},follow_redirects=True)
    assert b'AI SEO recommendation generated' in r.data
