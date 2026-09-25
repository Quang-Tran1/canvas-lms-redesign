/*
 * Calls Canvas's REST API from the content script.
 *
 * Requests go out with the page's own session cookie, so every widget sees
 * exactly what the signed-in user sees. No token handling of our own.
 */

export interface ApiResult<T> {
    data: T;
    /** The Link header's rel="next" URL, when the response was paginated. */
    next: string | null;
}

export interface ApiOptions {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
}

function csrfToken(): string {
    const match = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
}

function nextLink(header: string | null): string | null {
    if (!header) return null;
    for (const part of header.split(",")) {
        const match = part.match(/<([^>]+)>;\s*rel="next"/);
        if (match) return match[1];
    }
    return null;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
    };
    if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
        headers["X-CSRF-Token"] = csrfToken();
    }

    const response = await fetch(path, {
        method: options.method,
        headers,
        credentials: "same-origin",
        signal: options.signal,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok) {
        throw new Error(`${options.method || "GET"} ${path} responded ${response.status}`);
    }

    // Session-authenticated Canvas responses are prefixed with "while(1);" to
    // make them useless as a <script> to another origin.
    const text = (await response.text()).replace(/^while\(1\);/, "");
    return { data: JSON.parse(text) as T, next: nextLink(response.headers.get("Link")) };
}

/* Every page of a list endpoint. per_page is capped server-side, so the Link
   header is followed regardless of what was asked for.

   Stops if a "next" link points somewhere already fetched. Canvas never does
   that, but a proxy or a bug that did would otherwise loop forever against
   the user's own school server. */
export async function fetchAllPages<T>(path: string, signal?: AbortSignal): Promise<T[]> {
    const all: T[] = [];
    const seen = new Set<string>();
    let url: string | null = path;
    while (url && !seen.has(url)) {
        seen.add(url);
        const page: ApiResult<T[]> = await api<T[]>(url, { signal });
        all.push(...page.data);
        url = page.next;
    }
    return all;
}
