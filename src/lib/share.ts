/**
 * 전달 — ADR-008. 1순위: Web Share API로 prompt.md + 사진을 파일로 함께.
 * 보조: 프롬프트 클립보드 복사, 개별 다운로드.
 */

export interface ShareFile {
  name: string;
  blob: Blob;
}

export function canShareFiles(files: ShareFile[]): boolean {
  if (!("share" in navigator) || !("canShare" in navigator)) return false;
  const data = { files: files.map((f) => new File([f.blob], f.name, { type: f.blob.type })) };
  try {
    return (navigator as Navigator).canShare(data);
  } catch {
    return false;
  }
}

export type ShareResult = "shared" | "cancelled" | "unsupported" | "error";

/** prompt.md + 사진을 한 번에 공유. 미지원/취소/에러를 구분해 반환. */
export async function shareFiles(files: ShareFile[], title: string): Promise<ShareResult> {
  if (!canShareFiles(files)) return "unsupported";
  const data = {
    title,
    files: files.map((f) => new File([f.blob], f.name, { type: f.blob.type })),
  };
  try {
    await (navigator as Navigator).share(data);
    return "shared";
  } catch (e) {
    if ((e as Error).name === "AbortError") return "cancelled";
    return "error";
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadFile(file: ShareFile) {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
