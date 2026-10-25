import { SYSTEM_READY } from '@pulsedesk/shared';
import { Button } from '@pulsedesk/ui';
export default function Home() {
  return (
    <main>
      <h1>PulseDesk Web</h1>
      <Button disabled>{SYSTEM_READY}</Button>
    </main>
  );
}
