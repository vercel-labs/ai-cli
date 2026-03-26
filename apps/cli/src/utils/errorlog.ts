const errors: { time: Date; error: unknown }[] = [];
const MAX_ERRORS = 20;

export function logError(error: unknown) {
	errors.push({ time: new Date(), error });
	if (errors.length > MAX_ERRORS) {
		errors.shift();
	}
}
