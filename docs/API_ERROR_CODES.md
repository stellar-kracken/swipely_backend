# API Error Code Reference

This document provides a comprehensive list of error codes returned by the Bridge-Watch API, along with their meanings, causes, and recommended client actions.

## Error Response Structure

All error responses follow a consistent JSON structure to allow for easy parsing by clients.

```json
{
  "success": false,
  "error": "Error Category Name",
  "message": "Human-readable description of what went wrong",
  "details": {
    "field": "Optional structured data for debugging or programmatic handling"
  },
  "timestamp": "2026-04-29T10:00:00.000Z"
}
```

---

## HTTP Status Code Mapping

| Status Code | Description | General Meaning |
|:---:|:---:|:---|
| **400** | Bad Request | The request was invalid or cannot be otherwise served. |
| **401** | Unauthorized | Authentication is required and has failed or has not yet been provided. |
| **403** | Forbidden | The request was valid, but the server is refusing action. |
| **404** | Not Found | The requested resource could not be found. |
| **429** | Too Many Requests | The user has sent too many requests in a given amount of time. |
| **500** | Internal Server Error | A generic error message, given when an unexpected condition was encountered. |

---

## Detailed Error Reference

### Authentication & Security

| Error Code | HTTP Status | Meaning | Recommended Action |
|:---|:---:|:---|:---|
| `Unauthorized` | 401 | Missing or invalid authentication credentials. | Provide a valid API key via the `x-api-key` header. |
| `Forbidden` | 403 | The API key is valid but lacks the required permissions (scopes) or is blocked. | Ensure your API key has the necessary scopes for the requested endpoint. |

### Validation Errors

| Error Code | HTTP Status | Meaning | Recommended Action |
|:---|:---:|:---|:---|
| `Validation Failed` | 400 | The request body failed schema validation. | Check the `details` field for specific validation errors and fix the request payload. |
| `Path Validation Failed` | 400 | One or more path parameters (e.g., `:symbol`) are invalid. | Ensure the path parameters match the expected format (e.g., uppercase symbols). |
| `Query Validation Failed` | 400 | One or more query string parameters are invalid or missing. | Review the API documentation for valid query parameters and their types. |
| `Body Validation Failed` | 400 | The JSON body is malformed or contains invalid data types. | Validate the JSON syntax and ensure all required fields are present. |

### Rate Limiting

| Error Code | HTTP Status | Meaning | Recommended Action |
|:---|:---:|:---|:---|
| `Too Many Requests` | 429 | You have exceeded your assigned rate limit tier. | Implement exponential backoff and wait for the time specified in the `Retry-After` header. |

### Resource Management

| Error Code | HTTP Status | Meaning | Recommended Action |
|:---|:---:|:---|:---|
| `Rule not found` | 404 | The specified alert rule ID does not exist. | Verify the rule ID and ensure it hasn't been deleted. |
| `Template not found` | 404 | The requested alert template does not exist. | Check the list of available templates via `/api/v1/alert-rules/templates`. |
| `Configuration not found` | 404 | The requested configuration key does not exist. | Verify the key name or use the configuration list endpoint to see available keys. |

### Server & Integration Errors

| Error Code | HTTP Status | Meaning | Recommended Action |
|:---|:---:|:---|:---|
| `Internal Validation Error` | 500 | An unexpected error occurred within the validation engine. | Contact support or check the system status page. This usually indicates a bug. |
| `Evaluation failed` | 500 | An error occurred while evaluating alert rules against provided metrics. | Ensure the metrics provided are valid. If persistent, report the issue. |
| `HorizonTimeoutError` | 500/503 | A request to the Stellar Horizon server timed out. | Retry the request after a short delay. |

---

## Best Practices for Error Handling

1. **Check the Status Code First**: Always inspect the HTTP status code before parsing the response body.
2. **Log Correlation IDs**: Every error response includes an `x-correlation-id` header. Log this ID to help developers troubleshoot specific issues.
3. **Graceful Degradation**: If a specific non-critical endpoint (like analytics) fails, the client should degrade gracefully rather than failing entirely.
4. **Use Retry-After**: For 429 errors, strictly respect the `Retry-After` header value.

---

## Update Workflow

This document is maintained alongside the backend code. When adding new error types:
1. Update the appropriate middleware or service to return the new error code.
2. Append the new code to the table above.
3. Link the new code to any relevant feature documentation.
