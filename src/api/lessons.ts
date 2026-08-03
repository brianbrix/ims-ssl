export interface Lesson {
  id: string;
  title: string;
  period: string;
  originalName: string;
  fileName: string;
  uploadedAt: string;
  fileUrl?: string;
}

const ADMIN_TOKEN_KEY = "adminToken";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

function apiPath(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export function getAdminToken(): string {
  return localStorage.getItem(ADMIN_TOKEN_KEY) || "";
}

export function setAdminToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body.error || response.statusText;
  } catch {
    return response.statusText;
  }
}

export async function listLessons(): Promise<Lesson[]> {
  const response = await fetch(apiPath("/api/lessons"));
  if (!response.ok) throw new Error(await parseErrorMessage(response));
  return response.json();
}

export async function getLesson(id: string): Promise<Lesson> {
  const response = await fetch(apiPath(`/api/lessons/${id}`));
  if (!response.ok) throw new Error(await parseErrorMessage(response));
  return response.json();
}

export async function uploadLesson(
  file: File,
  title: string,
  period: string
): Promise<Lesson> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", title);
  formData.append("period", period);

  const response = await fetch(apiPath("/api/lessons"), {
    method: "POST",
    headers: { Authorization: `Bearer ${getAdminToken()}` },
    body: formData,
  });
  if (!response.ok) throw new Error(await parseErrorMessage(response));
  return response.json();
}

export async function deleteLesson(id: string): Promise<void> {
  const response = await fetch(apiPath(`/api/lessons/${id}`), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getAdminToken()}` },
  });
  if (!response.ok) throw new Error(await parseErrorMessage(response));
}

export function lessonFileUrl(id: string): string {
  return apiPath(`/api/lessons/${id}/file`);
}
