# WordPress Standalone MCP Server

A powerful [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides seamless integration between AI assistants and WordPress sites through the WordPress REST API. This server automatically discovers and creates individual tools for each WordPress REST API endpoint, enabling natural language WordPress management.

## ✨ Features

- **🔄 Dynamic Tool Generation**: Automatically creates individual tools for each discovered WordPress REST API endpoint
- **🌐 Multi-Site Support**: Manage multiple WordPress sites simultaneously from a single configuration
- **🔒 Secure Authentication**: Uses WordPress Application Passwords for secure API access
- **🎯 Smart Tool Filtering**: Include/exclude specific tools using exact match or regex patterns
- **📊 Comprehensive Coverage**: Support for posts, pages, users, media, comments, plugins, themes, and more
- **🚀 Zero Configuration Discovery**: Automatically maps all available endpoints without manual setup
- **⚡ High Performance**: Efficient endpoint discovery and request handling
- **🛡️ Error Handling**: Graceful error handling with detailed diagnostic messages

## 🚀 Quick Start

### Installation

```bash
# Install globally
npm install -g wp-standalone-mcp

# Or run directly with npx
npx github:diazoxide/wp-standalone-mcp start
```

### Basic Configuration

1. **Create a WordPress Application Password**:
   - Go to your WordPress admin → Users → Profile
   - Scroll to "Application Passwords" section
   - Create a new application password
   - Copy the generated password

2. **Create configuration file** (`wp-sites.json`):
   ```json
   {
     "myblog": {
       "URL": "https://myblog.com",
       "USER": "your_username",
       "PASS": "your_application_password"
     }
   }
   ```

3. **Configure Claude Desktop** (`claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "wordpress": {
         "command": "npx",
         "args": ["-y", "github:diazoxide/wp-standalone-mcp", "start"],
         "env": {
           "WP_SITES_PATH": "/absolute/path/to/wp-sites.json"
         }
       }
     }
   }
   ```

4. **Restart Claude Desktop** and start managing your WordPress sites!

## Tools Reference

### Dynamic Endpoint Tools

When the server starts, it automatically discovers all available WordPress REST API endpoints and creates individual tools for each endpoint/method combination. Tool names follow the pattern: `[site]_[method]_[resource]` or `[site]_[method]_[resource]_id` for ID-specific endpoints.

Examples:
- `myblog_get_v2_posts` - List all posts
- `myblog_get_v2_posts_id` - Get a specific post by ID
- `myblog_post_v2_posts` - Create a new post
- `myblog_put_v2_posts_id` - Update a specific post
- `myblog_delete_v2_posts_id` - Delete a specific post

### `wp_discover_endpoints`
Re-discovers all available REST API endpoints on a WordPress site.

**Arguments:**
```json
{
	"site": {
		"type": "string",
		"description": "Site alias (as defined in configuration)",
		"required": true
	}
}
```

**Returns:**
List of available endpoints with their methods and namespaces.

## 🔧 Configuration

### Environment Variables

- `WP_SITES_PATH`: Path to your WordPress sites configuration file
- `WP_SITES`: Direct JSON configuration (alternative to file)

### Site Configuration Schema

```json
{
  "site_alias": {
    "URL": "https://your-site.com",
    "USER": "wordpress_username", 
    "PASS": "application_password",
    "FILTERS": {
      "include": ["tool_name_patterns"],
      "exclude": ["tool_name_patterns"]
    }
  }
}
```

### Getting an Application Password

1. Log in to your WordPress admin dashboard
2. Go to Users → Profile
3. Scroll to the "Application Passwords" section
4. Enter a name for the application (e.g., "MCP Server")
5. Click "Add New Application Password"
6. Copy the generated password (you won't be able to see it again)

Note: Application Passwords require WordPress 5.6 or later and HTTPS.

### Advanced Tool Filtering

Control which WordPress operations are available by filtering tools:

```json
{
  "myblog": {
    "URL": "https://myblog.com",
    "USER": "admin",
    "PASS": "abcd 1234 efgh 5678",
    "FILTERS": {
      "include": [
        "myblog_get_v2_posts",
        "myblog_post_v2_posts",
        "/.*_get_.*_posts.*/"
      ],
      "exclude": [
        "myblog_delete_v2_posts_id",
        "/.*_.*_users.*/",
        "/.*_delete_.*/"
      ]
    }
  }
}
```

**Filter Rules:**
- `include`: Only specified tools are exposed (whitelist)
- `exclude`: Specified tools are hidden (blacklist)
- `include` takes precedence over `exclude`
- Supports exact matches and regex patterns (wrap in `/pattern/`)

## 🛠️ Generated Tools

The server automatically creates tools following this naming convention:
- **Pattern**: `[site]_[method]_[resource]` or `[site]_[method]_[resource]_id`
- **Examples**:
  - `myblog_get_v2_posts` - List all posts
  - `myblog_get_v2_posts_id` - Get specific post by ID
  - `myblog_post_v2_posts` - Create new post
  - `myblog_put_v2_posts_id` - Update specific post
  - `myblog_delete_v2_posts_id` - Delete specific post
  - `myblog_get_v2_media` - List media files
  - `myblog_get_v2_users` - List users

### Discovery Tool

- `wp_discover_endpoints` - Re-discover available endpoints for a site

## 💡 Usage Examples

Once configured, interact with your WordPress sites using natural language:

#### List and Query Posts
```
Can you show me all posts from myblog published in the last month?
```
```
Find all posts on testsite tagged with "technology" and "AI"
```
```
Show me draft posts from myblog that need review
```

#### Create and Edit Content
```
Create a new draft post on testsite titled "The Future of AI" with these key points: [points]
```
```
Update the featured image on myblog's latest post about machine learning
```
```
Add a new category called "Tech News" to myblog
```

#### Manage Comments
```
Show me all pending comments on myblog's latest post
```
```
Find comments from testsite that might be spam
```
```
List the most engaged commenters on myblog
```

#### Plugin Management
```
What plugins are currently active on myblog?
```
```
Check if any plugins on testsite need updates
```
```
Tell me about the security plugins installed on myblog
```

### Content Management
```
"Show me the last 5 posts from myblog"
"Create a new draft post titled 'AI and the Future' on myblog"
"Update the featured image for post ID 123 on myblog"
"Delete the post with ID 456 from myblog"
```

### Media Management
```
"List all images uploaded this month to myblog"
"Upload a new image to myblog media library"
"Get details for media file ID 789"
```

### User Management
```
"Show all users with editor role on myblog"
"Create a new contributor account on myblog"
"Update user permissions for user ID 101"
```

### Site Analysis
```
"What plugins are active on myblog?"
"Show me all pending comments"
"Get the current theme information"
"List all categories and their post counts"
```

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Claude AI     │    │  MCP Server      │    │  WordPress API  │
│                 │◄──►│                  │◄──►│                 │
│ Natural Language│    │ Dynamic Tools    │    │ REST Endpoints  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │  Configuration   │
                       │   wp-sites.json  │
                       └──────────────────┘
```

## 🔒 Security

- **Application Passwords**: Uses WordPress's secure application password system
- **HTTPS Required**: All connections must use HTTPS
- **Configuration Security**: Keep configuration files outside web-accessible directories
- **Principle of Least Privilege**: Use accounts with minimal required permissions
- **No Credential Storage**: Credentials are only used for API authentication

## 🐛 Troubleshooting

### Common Issues

**"Site not configured" error**
- Verify site alias in configuration matches usage
- Check configuration file path and format

**"Authentication failed" error**
- Verify application password is correct
- Ensure user account has necessary permissions
- Check if site URL is accessible

**"No tools discovered" error**
- Verify WordPress site has REST API enabled
- Check if site URL includes `/wp-json` accessibility
- Review any security plugins blocking REST API

### Debug Mode

Set `DEBUG=wp-mcp` environment variable for detailed logging:

```bash
DEBUG=wp-mcp npx github:diazoxide/wp-standalone-mcp start
```

## 📋 Requirements

- **WordPress**: 5.6+ (for Application Passwords)
- **Node.js**: 16+
- **HTTPS**: Required for Application Passwords
- **REST API**: Must be enabled (default in WordPress)

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🔗 Links

- **Repository**: [https://github.com/diazoxide/wp-standalone-mcp](https://github.com/diazoxide/wp-standalone-mcp)
- **Issues**: [https://github.com/diazoxide/wp-standalone-mcp/issues](https://github.com/diazoxide/wp-standalone-mcp/issues)
- **WordPress REST API**: [https://developer.wordpress.org/rest-api/](https://developer.wordpress.org/rest-api/)
- **Model Context Protocol**: [https://modelcontextprotocol.io/](https://modelcontextprotocol.io/)

## 🙏 Acknowledgments

- WordPress REST API team for the comprehensive API
- Anthropic for the Model Context Protocol specification
- The open-source community for continuous support and feedback

---

**Made with ❤️ for the WordPress and AI community**
