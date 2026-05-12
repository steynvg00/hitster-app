export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
	id: number;
	message: string;
	type: ToastType;
	duration: number;
}

let _toasts = $state<Toast[]>([]);
let _nextId = 0;

export const toasts = {
	get value() {
		return _toasts;
	}
};

export function pushToast(message: string, type: ToastType = 'success', duration = 4000) {
	const id = ++_nextId;
	_toasts = [..._toasts, { id, message, type, duration }];
	setTimeout(() => dismissToast(id), duration);
}

export function dismissToast(id: number) {
	_toasts = _toasts.filter((t) => t.id !== id);
}
