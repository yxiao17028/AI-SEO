import sys
import os
import traceback

# Add the project directory to the Python path
sys.path.insert(0, os.path.dirname(__file__))

try:
    # Try to import the Flask application object from app.py
    from app import app as application
except Exception as e:
    # If import fails, create a fallback WSGI app to display the error traceback
    error_msg = traceback.format_exc()
    
    # Also log to a local file in the project directory
    try:
        log_path = os.path.join(os.path.dirname(__file__), 'passenger_startup_error.log')
        with open(log_path, 'w') as f:
            f.write(error_msg)
    except Exception as log_err:
        pass

    def application(environ, start_response):
        status = '500 Internal Server Error'
        headers = [('Content-type', 'text/html; charset=utf-8')]
        start_response(status, headers)
        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Python Startup Error</title>
            <style>
                body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; background: #fafafa; color: #333; }}
                .container {{ max-width: 800px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #eaeaea; }}
                h1 {{ color: #e53e3e; font-size: 24px; margin-top: 0; }}
                pre {{ background: #1e1e1e; color: #d4d4d4; padding: 20px; border-radius: 6px; overflow-x: auto; font-family: Consolas, Monaco, monospace; font-size: 14px; line-height: 1.5; }}
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Python Startup Error (Application Failed to Start)</h1>
                <p>The Python application failed to initialize. Below is the traceback error:</p>
                <pre>{error_msg}</pre>
                <p><em>Note: This error log has also been saved to <strong>passenger_startup_error.log</strong> in your project directory.</em></p>
            </div>
        </body>
        </html>
        """
        return [html.encode('utf-8')]

