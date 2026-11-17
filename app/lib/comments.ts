export const MIN_COMMENT_LENGTH = 1;
export const MAX_COMMENT_LENGTH = 5000;

/** The element id a comment renders with, so links can land on it. */
export function commentAnchor(commentId: number) {
  return `comment-${commentId}`;
}
