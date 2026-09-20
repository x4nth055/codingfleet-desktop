'use strict';
// Built-in remote MCP servers, generated from the web app's assistant/static/js/mcp-catalog.js.
window.MCP_CATALOG = {
  "categories": [
    {
      "id": "docs",
      "name": "Docs & Knowledge"
    },
    {
      "id": "dev",
      "name": "Developer Tools"
    },
    {
      "id": "cloud",
      "name": "Cloud, Data & APIs"
    }
  ],
  "connectors": {
    "context7": {
      "name": "Context7",
      "category": "docs",
      "description": "Up-to-date, version-specific docs for any library or framework.",
      "authMode": "optional",
      "authHeaderName": "CONTEXT7_API_KEY",
      "url": "https://mcp.context7.com/mcp",
      "servers": [
        {
          "name": "Context7",
          "url": "https://mcp.context7.com/mcp"
        }
      ],
      "tools": [
        "resolve-library-id",
        "query-docs"
      ],
      "tokenHelp": "Optional — works without a key (rate-limited). Free key: <a href=\"https://context7.com/dashboard\" target=\"_blank\" rel=\"noopener\">context7.com/dashboard</a>",
      "tokenPlaceholder": "ctx7sk-... (optional)",
      "color": "#6e9eff"
    },
    "deepwiki": {
      "name": "DeepWiki",
      "category": "docs",
      "description": "Ask questions about any public GitHub repo (AI-generated wikis by Devin).",
      "authMode": "none",
      "authHeaderName": null,
      "url": "https://mcp.deepwiki.com/mcp",
      "servers": [
        {
          "name": "DeepWiki",
          "url": "https://mcp.deepwiki.com/mcp"
        }
      ],
      "tools": [
        "read_wiki_structure",
        "read_wiki_contents",
        "ask_question"
      ],
      "tokenHelp": "No token required.",
      "tokenPlaceholder": "Not required",
      "color": "#19b8a8"
    },
    "mslearn": {
      "name": "Microsoft Learn",
      "category": "docs",
      "description": "Official Microsoft / Azure / .NET docs and code samples.",
      "authMode": "none",
      "authHeaderName": null,
      "url": "https://learn.microsoft.com/api/mcp",
      "servers": [
        {
          "name": "Microsoft Learn",
          "url": "https://learn.microsoft.com/api/mcp"
        }
      ],
      "tools": [
        "microsoft_docs_search",
        "microsoft_code_sample_search",
        "microsoft_docs_fetch"
      ],
      "tokenHelp": "No token required.",
      "tokenPlaceholder": "Not required",
      "color": "#00a4ef"
    },
    "awsdocs": {
      "name": "AWS Knowledge",
      "category": "docs",
      "description": "Official AWS documentation, API references and best practices.",
      "authMode": "none",
      "authHeaderName": null,
      "url": "https://knowledge-mcp.global.api.aws",
      "servers": [
        {
          "name": "AWS Knowledge",
          "url": "https://knowledge-mcp.global.api.aws"
        }
      ],
      "tools": [
        "aws___search_documentation",
        "aws___read_documentation",
        "aws___recommend"
      ],
      "tokenHelp": "No token required.",
      "tokenPlaceholder": "Not required",
      "color": "#ff9900"
    },
    "cloudflaredocs": {
      "name": "Cloudflare Docs",
      "category": "docs",
      "description": "Workers, Pages, R2, KV — official Cloudflare documentation.",
      "authMode": "none",
      "authHeaderName": null,
      "url": "https://docs.mcp.cloudflare.com/mcp",
      "servers": [
        {
          "name": "Cloudflare Docs",
          "url": "https://docs.mcp.cloudflare.com/mcp"
        }
      ],
      "tools": [
        "search_cloudflare_documentation"
      ],
      "tokenHelp": "No token required.",
      "tokenPlaceholder": "Not required",
      "color": "#f6821f"
    },
    "github": {
      "name": "GitHub",
      "category": "dev",
      "description": "Repos, issues, pull requests, code search and actions.",
      "authMode": "required",
      "authHeaderName": null,
      "url": "https://api.githubcopilot.com/mcp/",
      "servers": [
        {
          "name": "GitHub (All)",
          "url": "https://api.githubcopilot.com/mcp/"
        },
        {
          "name": "GitHub Actions",
          "url": "https://api.githubcopilot.com/mcp/x/actions"
        },
        {
          "name": "GitHub Code Security",
          "url": "https://api.githubcopilot.com/mcp/x/code_security"
        },
        {
          "name": "GitHub Dependabot",
          "url": "https://api.githubcopilot.com/mcp/x/dependabot"
        },
        {
          "name": "GitHub Discussions",
          "url": "https://api.githubcopilot.com/mcp/x/discussions"
        },
        {
          "name": "GitHub Gists",
          "url": "https://api.githubcopilot.com/mcp/x/gists"
        },
        {
          "name": "GitHub Issues",
          "url": "https://api.githubcopilot.com/mcp/x/issues"
        },
        {
          "name": "GitHub Notifications",
          "url": "https://api.githubcopilot.com/mcp/x/notifications"
        },
        {
          "name": "GitHub Organizations",
          "url": "https://api.githubcopilot.com/mcp/x/orgs"
        },
        {
          "name": "GitHub Pull Requests",
          "url": "https://api.githubcopilot.com/mcp/x/pull_requests"
        },
        {
          "name": "GitHub Repositories",
          "url": "https://api.githubcopilot.com/mcp/x/repos"
        },
        {
          "name": "GitHub Users",
          "url": "https://api.githubcopilot.com/mcp/x/users"
        }
      ],
      "tools": [
        "create_repository",
        "search_repositories",
        "get_file_contents",
        "create_or_update_file",
        "create_pull_request",
        "get_repository",
        "list_repository_contents",
        "search_code"
      ],
      "tokenHelp": "Get a token: <a href=\"https://github.com/settings/tokens\" target=\"_blank\" rel=\"noopener\">GitHub Settings → Tokens</a>",
      "tokenPlaceholder": "ghp_...",
      "color": "#7b8cff"
    },
    "huggingface": {
      "name": "Hugging Face",
      "category": "dev",
      "description": "Search models, datasets, papers and Spaces on the Hub.",
      "authMode": "required",
      "authHeaderName": null,
      "url": "https://huggingface.co/mcp",
      "servers": [
        {
          "name": "Hugging Face MCP",
          "url": "https://huggingface.co/mcp"
        }
      ],
      "tools": [
        "hf_whoami",
        "space_search",
        "model_search",
        "model_details",
        "paper_search",
        "dataset_search",
        "dataset_details",
        "hf_doc_search",
        "hf_doc_fetch"
      ],
      "tokenHelp": "Get a token: <a href=\"https://huggingface.co/settings/tokens\" target=\"_blank\" rel=\"noopener\">Hugging Face Settings → Access Tokens</a>",
      "tokenPlaceholder": "hf_...",
      "color": "#7b8cff"
    },
    "sentry": {
      "name": "Sentry",
      "category": "dev",
      "description": "Pull errors, stack traces and performance issues from Sentry.",
      "authMode": "required",
      "authHeaderName": null,
      "url": "https://mcp.sentry.dev/mcp",
      "servers": [
        {
          "name": "Sentry",
          "url": "https://mcp.sentry.dev/mcp"
        }
      ],
      "tools": [],
      "tokenHelp": "Create a Personal Token: <a href=\"https://sentry.io/settings/account/api/auth-tokens/\" target=\"_blank\" rel=\"noopener\">Sentry → User Auth Tokens</a>",
      "tokenPlaceholder": "sntryu_...",
      "color": "#9d4edd"
    },
    "semgrep": {
      "name": "Semgrep",
      "category": "dev",
      "description": "Scan code for security vulnerabilities and bugs.",
      "authMode": "required",
      "authHeaderName": null,
      "url": "https://mcp.semgrep.ai/mcp",
      "servers": [
        {
          "name": "Semgrep",
          "url": "https://mcp.semgrep.ai/mcp"
        }
      ],
      "tools": [],
      "tokenHelp": "Create a token: <a href=\"https://semgrep.dev/orgs/-/settings/tokens\" target=\"_blank\" rel=\"noopener\">Semgrep → Settings → Tokens</a>",
      "tokenPlaceholder": "Semgrep app token...",
      "color": "#00c292"
    },
    "supabase": {
      "name": "Supabase",
      "category": "cloud",
      "description": "Query your database, manage tables, auth and edge functions.",
      "authMode": "required",
      "authHeaderName": null,
      "url": "https://mcp.supabase.com/mcp?read_only=true",
      "servers": [
        {
          "name": "Supabase (read-only, recommended)",
          "url": "https://mcp.supabase.com/mcp?read_only=true"
        },
        {
          "name": "Supabase (full access)",
          "url": "https://mcp.supabase.com/mcp"
        }
      ],
      "tools": [],
      "tokenHelp": "Create a Personal Access Token: <a href=\"https://supabase.com/dashboard/account/tokens\" target=\"_blank\" rel=\"noopener\">Supabase → Account → Access Tokens</a>. Avoid connecting production data.",
      "tokenPlaceholder": "sbp_...",
      "color": "#3ecf8e"
    },
    "neon": {
      "name": "Neon",
      "category": "cloud",
      "description": "Serverless Postgres — run SQL, manage branches and migrations.",
      "authMode": "required",
      "authHeaderName": null,
      "url": "https://mcp.neon.tech/mcp",
      "servers": [
        {
          "name": "Neon",
          "url": "https://mcp.neon.tech/mcp"
        }
      ],
      "tools": [],
      "tokenHelp": "Create an API key: <a href=\"https://console.neon.tech/app/settings/api-keys\" target=\"_blank\" rel=\"noopener\">Neon Console → API Keys</a>",
      "tokenPlaceholder": "napi_...",
      "color": "#00e599"
    },
    "stripe": {
      "name": "Stripe",
      "category": "cloud",
      "description": "Customers, payments, subscriptions and invoices.",
      "authMode": "required",
      "authHeaderName": null,
      "url": "https://mcp.stripe.com",
      "servers": [
        {
          "name": "Stripe",
          "url": "https://mcp.stripe.com"
        }
      ],
      "tools": [],
      "tokenHelp": "Use a <strong>restricted</strong> or test-mode key: <a href=\"https://dashboard.stripe.com/apikeys\" target=\"_blank\" rel=\"noopener\">Stripe Dashboard → API keys</a>",
      "tokenPlaceholder": "rk_... / sk_test_...",
      "color": "#635bff"
    },
    "heroku": {
      "name": "Heroku",
      "category": "cloud",
      "description": "Manage apps, dynos, add-ons and logs on Heroku.",
      "authMode": "required",
      "authHeaderName": null,
      "url": "https://mcp.heroku.com/mcp",
      "servers": [
        {
          "name": "Heroku",
          "url": "https://mcp.heroku.com/mcp"
        }
      ],
      "tools": [],
      "tokenHelp": "Get your API key from <a href=\"https://dashboard.heroku.com/account\" target=\"_blank\" rel=\"noopener\">Heroku Account Settings</a> or run <code>heroku auth:token</code>",
      "tokenPlaceholder": "HRKU-...",
      "color": "#79589f"
    }
  }
};
