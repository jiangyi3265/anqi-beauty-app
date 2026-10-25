// Display only. Never use this preview to grant VIP eligibility or create orders.
export function membershipCardFor(user, now = Date.now()) {
  if (!user?.id) return null
  if (user.vipLevel) return user.vipLevel
  const preview = user.membershipPreview
  if (preview?.displayOnly !== true || typeof preview.name !== 'string' || !preview.name.trim() || !(Date.parse(preview.expiresAt) > now)) return null
  return { name: preview.name, preview: true }
}
