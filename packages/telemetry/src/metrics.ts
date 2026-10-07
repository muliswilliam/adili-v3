import { type Attributes, type Counter, type Gauge, metrics } from '@opentelemetry/api';

const gauges = new Map<string, Gauge>();
const counters = new Map<string, Counter>();

function meter() {
  return metrics.getMeter('adili');
}

/** A gauge reading. The instrument is created on first use, so it follows whichever meter is current. */
export function recordGauge(
  name: string,
  value: number,
  attributes: Attributes,
  description: string,
): void {
  let gauge = gauges.get(name);
  if (!gauge) {
    gauge = meter().createGauge(name, { description });
    gauges.set(name, gauge);
  }
  gauge.record(value, attributes);
}

/** Adds to a counter. The instrument is created on first use. */
export function addCounter(
  name: string,
  value: number,
  attributes: Attributes,
  description: string,
): void {
  let counter = counters.get(name);
  if (!counter) {
    counter = meter().createCounter(name, { description });
    counters.set(name, counter);
  }
  counter.add(value, attributes);
}
