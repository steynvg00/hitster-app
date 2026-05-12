export function isNfcUnlockRequired(
	challenge: { nfc_lock_override?: boolean | null } | null | undefined,
	gameSet: { nfc_lock_enabled?: boolean | null } | null | undefined
): boolean {
	return (challenge?.nfc_lock_override ?? gameSet?.nfc_lock_enabled) === true;
}
