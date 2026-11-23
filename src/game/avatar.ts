export const AVATAR_SIZE = 20;
export const AVATAR_CELLS = AVATAR_SIZE ** 2;
export const AVATAR_PALETTE = [
  ["흰색", "#f8fafc"], ["노랑", "#ffd84d"], ["분홍", "#ff6b91"],
  ["주황", "#ff9652"], ["초록", "#4fd88a"], ["파랑", "#59abff"],
  ["보라", "#c98bff"], ["검정", "#141521"],
] as const;
export const BLANK_AVATAR = "0".repeat(AVATAR_CELLS);
