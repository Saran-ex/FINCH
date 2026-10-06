import { FinchViewport } from '@/components/finch/FinchViewport';
import type { VoiceState } from '@/types/mode';

export function ConversationMode({
  voiceState,
  onVoiceChange,
  aiReply,
}: {
  voiceState: VoiceState;
  onVoiceChange: () => void;
  aiReply?: string;
}) {
  return (
    <section className='mode-scene conversation-scene' aria-label='Conversation mode'>
      <div className='scene-heading'>
        <span className='scene-kicker'>FINCH / 01</span>
        <h1>Good morning.</h1>
      </div>
      <FinchViewport />
      {aiReply && (
        <div className='ai-reply-display' aria-live='polite'>
          <span className='reply-label'>Finch:</span>
          <span className='reply-text'>{aiReply}</span>
        </div>
      )}
    </section>
  );
}
