import { mapLimit } from '../clients/http.js';
import type { SeedContext } from '../context.js';
import type { Holdings } from '../data/declaration.js';
import { CURRENT_CYCLE, PERSONAS, PREVIOUS_CYCLE } from '../data/personas.js';
import {
  behaviourOf,
  cycleStatementDate,
  holdingsOf,
  type SyntheticOfficer,
  syntheticOfficers,
} from '../data/synthetic.js';
import { fixtureRoster } from '../data/roster.js';
import {
  type Declarant,
  declarantState,
  fileObligation,
  type MyObligation,
  startCarriedOver,
} from '../filing.js';
import type { SeedStep } from '../step.js';
import { syntheticDemoKey } from './onboarding.js';

const previousKey = `biennial:${String(PREVIOUS_CYCLE)}`;
const currentKey = `biennial:${String(CURRENT_CYCLE)}`;

/** What an officer files, obligation by obligation, oldest first. */
interface FilingPlan {
  cycleKey: string;
  holdings: Holdings;
  previous?: Holdings;
  amendTo?: Holdings;
}

async function fileAll(
  context: SeedContext,
  declarant: Declarant,
  plans: readonly FilingPlan[],
): Promise<number> {
  if (plans.length === 0) return 0;
  const { demoKey } = declarant;
  const { obligations, declarations } = await declarantState(await context.as(demoKey));
  let submitted = 0;
  for (const plan of plans) {
    const obligation = obligations.find(
      (o: MyObligation) => o.cycleKey === plan.cycleKey && o.status !== 'cancelled',
    );
    if (!obligation) throw new Error(`${demoKey} has no ${plan.cycleKey} obligation`);
    const existing = declarations.find(
      (d) => d.obligationId === obligation.id && d.status !== 'discarded',
    );
    submitted += await fileObligation(
      context,
      declarant,
      obligation,
      existing,
      plan.holdings,
      plan.previous,
      plan.amendTo,
    );
  }
  return submitted;
}

export function syntheticPlans(officer: SyntheticOfficer): FilingPlan[] {
  const behaviour = behaviourOf(officer);
  const plans: FilingPlan[] = [];
  const previousDate = cycleStatementDate(PREVIOUS_CYCLE);
  const currentDate = cycleStatementDate(CURRENT_CYCLE);
  const appointed = officer.appointmentDate;
  const owesPrevious = appointed <= previousDate;
  const owesCurrent = appointed <= currentDate;
  const owesInitial = appointed >= previousDate;
  if (owesInitial && behaviour.filesInitial) {
    plans.push({
      cycleKey: `initial:${appointed}`,
      holdings: holdingsOf(officer, appointed, null),
    });
  }
  const previous =
    owesPrevious && behaviour.filesPrevious
      ? holdingsOf(officer, previousDate, PREVIOUS_CYCLE)
      : undefined;
  if (previous) plans.push({ cycleKey: previousKey, holdings: previous });
  if (owesCurrent && behaviour.filesCurrent) {
    plans.push({
      cycleKey: currentKey,
      holdings: holdingsOf(officer, currentDate, CURRENT_CYCLE),
      previous:
        previous ??
        (owesInitial && behaviour.filesInitial ? holdingsOf(officer, appointed, null) : undefined),
    });
  }
  return plans;
}

/**
 * The declarations filed by `0-start`, through the portal's API as each declarant: the personas'
 * (Wanjiku's previous cycle only, with her current one started from what carries over, so she
 * files it live; Amina amended to version 2)
 * and the synthetic officers', most on time, a minority not at all, some leaving a registry
 * holding out. Review cases, registry checks and acknowledgement slips follow from the services'
 * own workflows.
 */
export const filings: SeedStep = {
  id: 'filings',
  title: 'Declarations: personas and synthetic volume',
  async run(context) {
    let submitted = 0;
    for (const persona of PERSONAS) {
      const { previous, current, amendedTo, startsCurrent } = persona.filings;
      const row = fixtureRoster(persona.commission).find(
        (r) => r.nationalId === persona.nationalId,
      );
      if (!row) throw new Error(`Persona ${persona.demoKey} is not in its roster fixture`);
      const declarant = {
        demoKey: persona.demoKey,
        birth: { date: row.dateOfBirth, place: row.placeOfBirth },
      };
      submitted += await fileAll(context, declarant, [
        { cycleKey: previousKey, holdings: previous },
        ...(current
          ? [{ cycleKey: currentKey, holdings: current, previous, amendTo: amendedTo }]
          : []),
      ]);
      if (startsCurrent) {
        const { obligations, declarations } = await declarantState(
          await context.as(persona.demoKey),
        );
        const obligation = obligations.find(
          (o) => o.cycleKey === currentKey && o.status !== 'cancelled',
        );
        if (!obligation) throw new Error(`${persona.demoKey} has no ${currentKey} obligation`);
        const { started } = await startCarriedOver(
          context,
          declarant,
          obligation,
          declarations.find((d) => d.obligationId === obligation.id && d.status !== 'discarded'),
          previous,
        );
        if (started) context.log(`    ${persona.demoKey}: current declaration started`);
      }
    }
    const officers = [...(await syntheticOfficers(context)).values()].flat();
    let done = 0;
    await mapLimit(officers, context.config.DEMO_SEED_CONCURRENCY, async (officer) => {
      const declarant = {
        demoKey: syntheticDemoKey(officer.nationalId),
        birth: { date: officer.dateOfBirth, place: officer.placeOfBirth },
      };
      const made = await fileAll(context, declarant, syntheticPlans(officer));
      submitted += made;
      done++;
      if (done % 250 === 0)
        context.log(`    ${String(done)} of ${String(officers.length)} officers`);
    });
    return { changed: submitted, notes: [`${String(submitted)} submissions`] };
  },
};
