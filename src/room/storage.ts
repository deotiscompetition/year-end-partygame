// 새로고침해도 권한을 유지하기 위한 브라우저 저장값입니다. 관리자 토큰은 URL에 넣지 않습니다.
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 사생활 보호 모드 등에서는 저장 없이 진행합니다.
  }
};

export const loadAdmin = (code: string) => read(`admin:${code}`);
export const saveAdmin = (code: string, token: string) => write(`admin:${code}`, token);
export const loadPlayer = (code: string) => read(`player:${code}`);
export const savePlayer = (code: string, token: string | null) => write(`player:${code}`, token);
