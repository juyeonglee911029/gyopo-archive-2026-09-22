type FriendConnectionLike = {
  requesterId: string;
  addresseeId: string;
  status: string;
};

type OnlineMemberLike = {
  lastLoginAt?: string;
  lastSeenAt?: string;
};

export function sortOnlineUsersByLogin<T extends OnlineMemberLike>(users: readonly T[]): T[] {
  const timestamp = (value?: string) => {
    const parsed = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const loginTime = (user: OnlineMemberLike) => timestamp(user.lastLoginAt) || timestamp(user.lastSeenAt);

  return [...users].sort((a, b) => loginTime(b) - loginTime(a) || timestamp(b.lastSeenAt) - timestamp(a.lastSeenAt));
}

export function addMissingIncomingLikeCandidates<T extends { id: string }>(
  candidates: readonly T[],
  incomingCandidates: readonly T[],
): T[] {
  const existingIds = new Set(candidates.map((candidate) => candidate.id));
  const missing: T[] = [];
  for (const candidate of incomingCandidates) {
    if (existingIds.has(candidate.id)) continue;
    existingIds.add(candidate.id);
    missing.push(candidate);
  }
  return [...candidates, ...missing];
}

export function prioritizeIncomingLikes<T extends { id: string }>(
  candidates: readonly T[],
  connections: readonly FriendConnectionLike[],
  userId?: string,
): T[] {
  if (!userId) return [...candidates];

  const incomingIds = new Set(connections
    .filter((connection) => connection.status === 'pending' && connection.addresseeId === userId)
    .map((connection) => connection.requesterId));
  const incoming: T[] = [];
  const remaining: T[] = [];
  for (const candidate of candidates) {
    (incomingIds.has(candidate.id) ? incoming : remaining).push(candidate);
  }
  return [...incoming, ...remaining];
}
