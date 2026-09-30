export type FriendMessageSummary = {
  authorId: string;
  createdAt: string;
};

export function isUnreadFriendMessage(latestMessage: FriendMessageSummary | null | undefined, userId: string, lastReadAt?: string | null): boolean {
  if (!latestMessage || latestMessage.authorId === userId) return false;
  const messageTime = Date.parse(latestMessage.createdAt);
  if (!Number.isFinite(messageTime)) return false;
  const readTime = lastReadAt ? Date.parse(lastReadAt) : Number.NaN;
  return !Number.isFinite(readTime) || messageTime > readTime;
}
