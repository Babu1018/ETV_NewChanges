import { readApiError, wrapNetworkError } from "./apiError.js";
import { joinAuthUrl } from "../components/auth/authApi.js";
import { defaultAuthApiBaseUrl } from "./authConfig.js";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

function usersUrl(path = "") {
  const suffix = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  return joinAuthUrl(defaultAuthApiBaseUrl, `/api/users${suffix}`);
}

function authHeaders(accessToken) {
  if (!accessToken) {
    throw new Error("You must be signed in.");
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

export async function fetchUsersList(accessToken) {
  try {
    const res = await fetchWithTimeout(usersUrl(), {
      headers: authHeaders(accessToken),
    });
    if (!res.ok) {
      throw new Error(await readApiError(res));
    }
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch (e) {
    throw wrapNetworkError(e);
  }
}

export async function createUser(accessToken, payload) {
  try {
    const res = await fetchWithTimeout(usersUrl(), {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(await readApiError(res));
    }
    return res.json();
  } catch (e) {
    throw wrapNetworkError(e);
  }
}

export async function updateUser(accessToken, userId, payload) {
  try {
    const res = await fetchWithTimeout(usersUrl(`/${userId}`), {
      method: "PATCH",
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(await readApiError(res));
    }
    return res.json();
  } catch (e) {
    throw wrapNetworkError(e);
  }
}

export async function deleteUser(accessToken, userId) {
  try {
    const res = await fetchWithTimeout(usersUrl(`/${userId}`), {
      method: "DELETE",
      headers: authHeaders(accessToken),
    });
    if (!res.ok) {
      throw new Error(await readApiError(res));
    }
  } catch (e) {
    throw wrapNetworkError(e);
  }
}
