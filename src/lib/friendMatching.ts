export type FriendLikeIntent = 'create' | 'waiting' | 'matched';

export function friendLikeIntent(
  connection: { requesterId: string; addresseeId: string; status: string } | null,
  viewerId: string,
): FriendLikeIntent {
  if (!connection || connection.status === 'declined') return 'create';
  if (connection.status === 'accepted') return 'matched';
  if (connection.status === 'pending' && connection.addresseeId === viewerId) return 'matched';
  return 'waiting';
}
