import { Box, Text } from 'ink';
import { getSetting } from '../config/settings.js';
import { renderMarkdown } from '../utils/markdown.js';

export type MessageType = 'user' | 'assistant' | 'tool' | 'error' | 'info';

export interface Message {
  id: number;
  type: MessageType;
  content: string;
  tool?: string;
}

interface Props {
  message: Message;
}

export function Message({ message }: Props) {
  const spacing = getSetting('spacing');
  const markdown = getSetting('markdown');

  const content = message.type === 'assistant' && markdown
    ? renderMarkdown(message.content)
    : message.content;

  switch (message.type) {
    case 'user':
      return (
        <Box marginTop={spacing}>
          <Text dimColor>› </Text>
          <Text>{message.content}</Text>
        </Box>
      );
    case 'assistant':
      return (
        <Box marginTop={0} marginBottom={0}>
          <Text>{content}</Text>
        </Box>
      );
    case 'tool':
      return (
        <Box marginTop={0} marginBottom={0}>
          <Text dimColor>{message.content}</Text>
        </Box>
      );
    case 'error':
      return (
        <Box marginTop={0}>
          <Text dimColor>error: {message.content}</Text>
        </Box>
      );
    case 'info':
      return (
        <Box marginTop={0}>
          <Text dimColor>{message.content}</Text>
        </Box>
      );
    default:
      return null;
  }
}
