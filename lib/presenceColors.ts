const HUES = [199, 280, 32, 158, 340, 120, 10];

export function colorForUserId(userId: string): string {
  let n = 0;
  for (let i = 0; i < userId.length; i++) n += userId.charCodeAt(i);
  const h = HUES[n % HUES.length];
  return `hsl(${h} 75% 55%)`;
}
