#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError, ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import axios from 'axios';
import fs from 'fs/promises';
import os from 'os';

// Load site config from config file
async function loadSiteConfig() {
	let configString = process.env.WP_SITES;
	let configPath = process.env.WP_SITES_PATH;

	try {
		if(configPath) {
			configPath = configPath.replace(/^~/, os.homedir)
			configString = await fs.readFile(configPath, 'utf8');
		}

		if(!configString) {
			throw new Error("One of WP_SITES_PATH or WP_SITES environment variable is required");
		}
		const config = JSON.parse(configString);


		// Validate and normalize the config
		const normalizedConfig = {};
		for (const [alias, site] of Object.entries(config)) {
			if (!site.URL || !site.USER || !site.PASS) {
				console.error(`Invalid configuration for site ${alias}: missing required fields`);
				continue;
			}

			normalizedConfig[alias.toLowerCase()] = {
				url: site.URL.replace(/\/$/, ''),
				username: site.USER,
				auth: site.PASS,
				filters: site.FILTERS || { include: [], exclude: [] }
			};
		}

		return normalizedConfig;
	} catch (error) {
		if (error.code === 'ENOENT') {
			throw new Error(`Config file not found at: ${configPath}`);
		}
		throw new Error(`Failed to load config: ${error.message}`);
	}
}

// WordPress client class
class WordPressClient {
	constructor(site) {
		const config = {
			baseURL: `${site.url}/wp-json`,
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json'
			}
		};

		if (site.auth) {
			const credentials = `${site.username}:${site.auth.replace(/\s+/g, '')}`;
			config.headers['Authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`;
		}

		this.client = axios.create(config);
	}

	async discoverEndpoints() {
		const response = await this.client.get('/');
		const routes = response.data?.routes ?? {};
		return Object.entries(routes).map(([path, info]) => ({
			methods: info.methods ?? [],
			namespace: info.namespace ?? 'wp/v2',
			endpoints: [path]
		}));
	}

	async makeRequest(endpoint, method = 'GET', params) {
		const path = endpoint.replace(/^\/wp-json/, '').replace(/^\/?/, '/');
		const config = { method, url: path };

		if (method === 'GET' && params) {
			config.params = params;
		} else if (params) {
			config.data = params;
		}

		const response = await this.client.request(config);
		return response.data;
	}
}

// Function to generate tool name from endpoint
function generateToolName(site, endpoint, method) {
	// Extract key parts of the endpoint
	const parts = endpoint.split('/').filter(p => p && !p.includes('?P<') && !p.includes('('));

	// Get the resource type (usually the last non-parameter part)
	let resource = '';
	if (parts.length >= 2) {
		// Take last 2 parts for context (e.g., "posts", "categories")
		resource = parts.slice(-2).join('_');
	} else if (parts.length === 1) {
		resource = parts[0];
	}

	// Clean the resource name
	resource = resource.replace(/[^\w]/g, '_');

	// Check if endpoint has ID parameter
	const hasId = endpoint.includes('(?P<id>') || endpoint.includes('(?P<');
	const idSuffix = hasId ? '_id' : '';

	// Build tool name: site_method_resource[_id]
	const toolName = `${site}_${method.toLowerCase()}_${resource}${idSuffix}`;

	// Ensure it's under 64 characters
	if (toolName.length > 64) {
		// Truncate resource part if needed
		const maxResourceLen = 64 - `${site}_${method.toLowerCase()}_${idSuffix}`.length;
		resource = resource.substring(0, maxResourceLen);
		return `${site}_${method.toLowerCase()}_${resource}${idSuffix}`;
	}

	return toolName;
}

// Function to parse endpoint parameters from path
function parseEndpointParams(endpoint) {
	const params = [];
	const regex = /\((?:\?P<(\w+)>)?([^)]+)\)/g;
	let match;

	while ((match = regex.exec(endpoint)) !== null) {
		const paramName = match[1] || match[2].replace(/[^\w]/g, '');
		params.push({
			name: paramName,
			required: !endpoint.includes(`(?P<${paramName}>`) || !match[0].includes('?')
		});
	}

	return params;
}

// Function to check if tool should be included based on filters
function shouldIncludeTool(toolName, filters) {
	// Check include filters first (if specified, only these are allowed)
	if (filters.include && filters.include.length > 0) {
		for (const pattern of filters.include) {
			// Check exact match
			if (pattern === toolName) return true;
			
			// Check regex match (patterns starting with / are treated as regex)
			if (pattern.startsWith('/') && pattern.endsWith('/')) {
				try {
					const regex = new RegExp(pattern.slice(1, -1));
					if (regex.test(toolName)) return true;
				} catch (e) {
					console.error(`Invalid regex pattern: ${pattern}`);
				}
			}
		}
		// If include filters exist and no match, exclude
		return false;
	}
	
	// Check exclude filters
	if (filters.exclude && filters.exclude.length > 0) {
		for (const pattern of filters.exclude) {
			// Check exact match
			if (pattern === toolName) return false;
			
			// Check regex match
			if (pattern.startsWith('/') && pattern.endsWith('/')) {
				try {
					const regex = new RegExp(pattern.slice(1, -1));
					if (regex.test(toolName)) return false;
				} catch (e) {
					console.error(`Invalid regex pattern: ${pattern}`);
				}
			}
		}
	}
	
	// If no include filters and not excluded, include it
	return true;
}

// Function to create tool definition for an endpoint
function createEndpointTool(site, endpoint, method, routeInfo) {
	const toolName = generateToolName(site, endpoint, method);
	const pathParams = parseEndpointParams(endpoint);

	// Build input schema
	const properties = {};
	const required = [];

	// Add path parameters
	pathParams.forEach(param => {
		properties[param.name] = {
			type: "string",
			description: `Path parameter: ${param.name}`
		};
		if (param.required) {
			required.push(param.name);
		}
	});

	// Add query/body parameters based on method
	if (method === 'GET') {
		properties.params = {
			type: "object",
			description: "Query parameters for the request"
		};
	} else if (['POST', 'PUT', 'PATCH'].includes(method)) {
		properties.data = {
			type: "object",
			description: "Request body data"
		};
	}

	// Check if endpoint has ID parameter
	const hasId = endpoint.includes('(?P<id>') || endpoint.includes('(?P<');

	// Create more descriptive explanation
	let description = `${method} request to ${endpoint}`;

	// Add resource-specific descriptions
	if (endpoint.includes('/posts')) {
		if (method === 'GET' && hasId) {
			description = `Get a specific post by ID`;
		} else if (method === 'GET') {
			description = `List posts with optional filters`;
		} else if (method === 'POST') {
			description = `Create a new post`;
		} else if (method === 'PUT' || method === 'PATCH') {
			description = `Update an existing post`;
		} else if (method === 'DELETE') {
			description = `Delete a post`;
		}
	} else if (endpoint.includes('/pages')) {
		if (method === 'GET' && hasId) {
			description = `Get a specific page by ID`;
		} else if (method === 'GET') {
			description = `List pages with optional filters`;
		} else if (method === 'POST') {
			description = `Create a new page`;
		} else if (method === 'PUT' || method === 'PATCH') {
			description = `Update an existing page`;
		} else if (method === 'DELETE') {
			description = `Delete a page`;
		}
	} else if (endpoint.includes('/users')) {
		if (method === 'GET' && hasId) {
			description = `Get a specific user by ID`;
		} else if (method === 'GET') {
			description = `List users`;
		} else if (method === 'POST') {
			description = `Create a new user`;
		} else if (method === 'PUT' || method === 'PATCH') {
			description = `Update user details`;
		} else if (method === 'DELETE') {
			description = `Delete a user`;
		}
	} else if (endpoint.includes('/media')) {
		if (method === 'GET' && hasId) {
			description = `Get specific media item details`;
		} else if (method === 'GET') {
			description = `List media items`;
		} else if (method === 'POST') {
			description = `Upload new media`;
		} else if (method === 'DELETE') {
			description = `Delete media item`;
		}
	} else if (endpoint.includes('/categories')) {
		if (method === 'GET' && hasId) {
			description = `Get a specific category`;
		} else if (method === 'GET') {
			description = `List categories`;
		} else if (method === 'POST') {
			description = `Create a new category`;
		} else if (method === 'PUT' || method === 'PATCH') {
			description = `Update category`;
		} else if (method === 'DELETE') {
			description = `Delete a category`;
		}
	} else if (endpoint.includes('/tags')) {
		if (method === 'GET' && hasId) {
			description = `Get a specific tag`;
		} else if (method === 'GET') {
			description = `List tags`;
		} else if (method === 'POST') {
			description = `Create a new tag`;
		} else if (method === 'PUT' || method === 'PATCH') {
			description = `Update tag`;
		} else if (method === 'DELETE') {
			description = `Delete a tag`;
		}
	}

	// Add site and endpoint info
	description += ` on ${site} site. Endpoint: ${endpoint}`;

	return {
		name: toolName,
		description,
		inputSchema: {
			type: "object",
			properties,
			required: required.length > 0 ? required : undefined
		}
	};
}

// Start the server
async function main() {
	try {
		// Load configuration
		const siteConfig = await loadSiteConfig();
		const clients = new Map();
		const dynamicTools = new Map();

		for (const [alias, site] of Object.entries(siteConfig)) {
			clients.set(alias, new WordPressClient(site));
		}

		// Discover endpoints for all sites
		console.error('Discovering WordPress endpoints...');
		for (const [alias, client] of clients.entries()) {
			try {
				const endpoints = await client.discoverEndpoints();

				// Generate tools for each endpoint
				const siteInfo = siteConfig[alias];
				endpoints.forEach(route => {
					route.endpoints.forEach(endpoint => {
						route.methods.forEach(method => {
							const tool = createEndpointTool(alias, endpoint, method, route);
							// Check if this tool should be included
							if (shouldIncludeTool(tool.name, siteInfo.filters)) {
								dynamicTools.set(tool.name, {
									site: alias,
									endpoint,
									method,
									tool
								});
							}
						});
					});
				});

				console.error(`Discovered ${endpoints.length} endpoints for site: ${alias}`);
			} catch (error) {
				console.error(`Failed to discover endpoints for ${alias}: ${error.message}`);
			}
		}

		// Initialize server
		const server = new Server({
			name: "wp-standalone-mcp",
			version: "1.0.0"
		}, {
			capabilities: { tools: {} }
		});

		// Tool definitions
		server.setRequestHandler(ListToolsRequestSchema, async () => {
			// Collect all dynamic tools
			const tools = [];

			// Add dynamic endpoint tools
			for (const [_, toolInfo] of dynamicTools) {
				tools.push(toolInfo.tool);
			}

			// Add discovery tool for convenience
			tools.push({
				name: "wp_discover_endpoints",
				description: "Re-discover all available REST API endpoints on a WordPress site",
				inputSchema: {
					type: "object",
					properties: {
						site: { type: "string", description: "Site alias" }
					},
					required: ["site"]
				}
			});

			return { tools };
		});

		// Tool handlers
		server.setRequestHandler(CallToolRequestSchema, async (request) => {
			const { name, arguments: args } = request.params;

			// Handle discovery tool
			if (name === "wp_discover_endpoints") {
				const client = clients.get(args.site.toLowerCase());
				if (!client) throw new McpError(ErrorCode.InvalidParams, `Unknown site: ${args.site}`);

				// Re-discover endpoints
				const endpoints = await client.discoverEndpoints();

				// Update dynamic tools
				const siteAlias = args.site.toLowerCase();
				// Remove old tools for this site
				for (const [toolName, toolInfo] of dynamicTools) {
					if (toolInfo.site === siteAlias) {
						dynamicTools.delete(toolName);
					}
				}

				// Add new tools
				const siteInfo = siteConfig[siteAlias];
				endpoints.forEach(route => {
					route.endpoints.forEach(endpoint => {
						route.methods.forEach(method => {
							const tool = createEndpointTool(siteAlias, endpoint, method, route);
							// Check if this tool should be included
							if (shouldIncludeTool(tool.name, siteInfo.filters)) {
								dynamicTools.set(tool.name, {
									site: siteAlias,
									endpoint,
									method,
									tool
								});
							}
						});
					});
				});

				return { content: [{ type: "text", text: JSON.stringify(endpoints, null, 2) }] };
			}

			// Check if it's a dynamic endpoint tool
			const toolInfo = dynamicTools.get(name);
			if (toolInfo) {
				const client = clients.get(toolInfo.site);
				if (!client) throw new McpError(ErrorCode.InvalidParams, `Site not found: ${toolInfo.site}`);

				// Build the actual endpoint path by replacing parameters
				let actualEndpoint = toolInfo.endpoint;
				const pathParams = parseEndpointParams(toolInfo.endpoint);

				// Replace path parameters in the endpoint
				pathParams.forEach(param => {
					if (args[param.name]) {
						// Replace WordPress REST route patterns with actual values
						const patterns = [
							`(?P<${param.name}>\\d+)`,
							`(?P<${param.name}>[\\d]+)`,
							`(?P<${param.name}>[^/]+)`,
							`(?P<${param.name}>[\\w-]+)`,
							`<${param.name}>`,
						];

						for (const pattern of patterns) {
							actualEndpoint = actualEndpoint.replace(new RegExp(pattern), args[param.name]);
						}
					}
				});

				// Make the request with appropriate parameters
				const requestParams = args.params || args.data;
				const result = await client.makeRequest(actualEndpoint, toolInfo.method, requestParams);

				return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
			}

			throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
		});

		// Start server
		const transport = new StdioServerTransport();
		await server.connect(transport);

		console.error(`WordPress MCP server started with ${clients.size} site(s) configured`);
	} catch (error) {
		console.error(`Server failed to start: ${error.message}`);
		process.exit(1);
	}
}

main();
