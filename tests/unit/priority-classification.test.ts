import { QueuePriority } from '../../src/domain/queue/enums';
import {
  PriorityClassificationService,
  priorityClassificationService,
} from '../../src/domain/queue/priority-classification';

describe('PriorityClassificationService', () => {
  const service = priorityClassificationService;

  it('classifies urgent keywords as Red', () => {
    const result = service.classify({ text: 'Production is down, this is urgent' });
    expect(result.priority).toBe(QueuePriority.Red);
    expect(result.automatic).toBe(true);
    expect(result.matchedSignals).toEqual(expect.arrayContaining(['down', 'urgent']));
    expect(result.reason).toMatch(/Urgent signals/);
  });

  it('matches whole words only (does not flag "download" as "down")', () => {
    const result = service.classify({ text: 'Please download the latest report' });
    expect(result.priority).toBe(QueuePriority.Yellow); // matches "please"
    expect(result.matchedSignals).not.toContain('down');
  });

  it('treats an imminent deadline as a Red signal', () => {
    const result = service.classify({ text: 'wrap up the notes', hasUpcomingDeadline: true });
    expect(result.priority).toBe(QueuePriority.Red);
    expect(result.matchedSignals).toContain('deadline-imminent');
  });

  it('classifies attention keywords as Yellow', () => {
    const result = service.classify({ text: 'Can you review this today?' });
    expect(result.priority).toBe(QueuePriority.Yellow);
    expect(result.matchedSignals).toEqual(expect.arrayContaining(['review', 'today']));
  });

  it('treats a question (mark or flag) as a Yellow signal', () => {
    expect(service.classify({ text: 'what is the status' }).priority).toBe(QueuePriority.Green);
    expect(service.classify({ text: 'what is the status?' }).priority).toBe(QueuePriority.Yellow);
    expect(service.classify({ text: 'status update', isQuestion: true }).priority).toBe(
      QueuePriority.Yellow,
    );
  });

  it('treats an owner mention as a Yellow signal', () => {
    const result = service.classify({ text: 'fyi nothing pressing', mentionsOwner: true });
    expect(result.priority).toBe(QueuePriority.Yellow);
    expect(result.matchedSignals).toContain('owner-mentioned');
  });

  it('defaults to Green when no signals are present', () => {
    const result = service.classify({ text: 'fyi nothing pressing here' });
    expect(result.priority).toBe(QueuePriority.Green);
    expect(result.matchedSignals).toHaveLength(0);
    expect(result.reason).toMatch(/defaulted to Green/);
  });

  it('lets Red signals win over Yellow signals', () => {
    const result = service.classify({ text: 'please review, this is a critical blocker?' });
    expect(result.priority).toBe(QueuePriority.Red);
  });

  it('deduplicates repeated Yellow signals', () => {
    const result = service.classify({ text: 'review review review please', isQuestion: true });
    const reviews = result.matchedSignals.filter((s) => s === 'review');
    expect(reviews).toHaveLength(1);
  });

  it('supports custom keyword sets', () => {
    const custom = new PriorityClassificationService(['kaboom'], ['meh']);
    expect(custom.classify({ text: 'total kaboom now' }).priority).toBe(QueuePriority.Red);
    expect(custom.classify({ text: 'just meh' }).priority).toBe(QueuePriority.Yellow);
    expect(custom.classify({ text: 'urgent outage' }).priority).toBe(QueuePriority.Green);
  });
});
