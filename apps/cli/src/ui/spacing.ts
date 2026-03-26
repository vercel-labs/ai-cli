/**
 * Centralizes vertical spacing decisions between user input and assistant/tool output.
 *
 * Goals:
 * - exactly one visual blank-line separator before the next output block
 * - consistent handling for first spinner/status line after a submitted user message
 */
export class SpacingController {
	private needsGapBeforeOutput = false;
	private firstStatusAfterUser = false;

	constructor(private readonly write: (text: string) => void) {}

	/**
	 * Called after a user message is submitted.
	 */
	markUserSubmit(): void {
		this.needsGapBeforeOutput = true;
		this.firstStatusAfterUser = true;
	}

	/**
	 * Called after a confirmation choice is denied/cancelled.
	 * The "› no" line acts like a user message boundary — a new gap
	 * is needed before the next output.
	 */
	markAfterConfirm(): void {
		this.needsGapBeforeOutput = true;
		this.firstStatusAfterUser = false;
	}

	/**
	 * Called after a confirmed action is accepted and its UI is erased.
	 * The blank line from beforeStatus() should still be in the terminal
	 * above the cursor, so we do NOT request another gap.
	 */
	markAfterConfirmAccepted(): void {
		this.needsGapBeforeOutput = false;
		this.firstStatusAfterUser = false;
	}

	/**
	 * Called after rendering a message block that does not already emit its
	 * own trailing blank separator (for example assistant/error single-line
	 * outputs).
	 */
	markAfterBareMessage(): void {
		this.needsGapBeforeOutput = true;
		this.firstStatusAfterUser = false;
	}

	/**
	 * Ensure exactly one separator line before normal output blocks.
	 */
	beforeOutput(): void {
		if (!this.needsGapBeforeOutput) {
			return;
		}
		this.needsGapBeforeOutput = false;
		this.firstStatusAfterUser = false;
		this.write("\n");
	}

	/**
	 * Ensure exactly one separator line before the first status/spinner line.
	 */
	beforeStatus(): void {
		if (this.firstStatusAfterUser) {
			this.firstStatusAfterUser = false;
			this.needsGapBeforeOutput = false;
			this.write("\n");
			return;
		}
		this.beforeOutput();
	}
}
