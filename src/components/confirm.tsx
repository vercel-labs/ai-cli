import { Text, useInput } from 'ink';

interface Props {
  message: string;
  onConfirm: (confirmed: boolean) => void;
}

export function Confirm({ message, onConfirm }: Props) {
  useInput((input) => {
    if (input.toLowerCase() === 'y') {
      onConfirm(true);
    } else if (input.toLowerCase() === 'n' || input === '\x1b') {
      onConfirm(false);
    }
  });

  return <Text dimColor>{message} [y/n]</Text>;
}
