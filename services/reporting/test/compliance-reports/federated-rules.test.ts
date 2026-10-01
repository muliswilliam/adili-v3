import type { FormMV1 } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import {
  federatedRuleProblems,
  reportCountsOf,
} from '../../src/compliance-reports/federated-submission.js';
import { tscFormM } from '../support/federated.js';

/** The day of a federated submission for FY 2027, after the year's reports open. */
const TODAY = '2028-07-20';

const problemPaths = (document: FormMV1, today = TODAY) =>
  federatedRuleProblems(document, today).map((problem) => problem.path);

describe('federated Form M business rules', () => {
  it('a complete, consistent document breaks no rule', () => {
    expect(federatedRuleProblems(tscFormM(), TODAY)).toEqual([]);
  });

  describe('period matches the financial year', () => {
    it('Part I period must run 1 July to 30 June of the financial year it names', () => {
      const document = tscFormM();
      document.partI.period = { from: '2027-08-01', to: '2028-07-31', financialYearStart: 2027 };

      expect(problemPaths(document)).toEqual(['partI.period.from', 'partI.period.to']);
    });

    it('a financial year before reports exist is refused', () => {
      const document = tscFormM();
      document.partI.period = { from: '2023-07-01', to: '2024-06-30', financialYearStart: 2023 };

      expect(problemPaths(document)).toEqual(['partI.period.financialYearStart']);
    });

    it('a financial year whose reports are not open yet (before 1 April of its last half) is refused', () => {
      expect(problemPaths(tscFormM(), '2028-03-31')).toEqual(['partI.period.financialYearStart']);
      expect(problemPaths(tscFormM(), '2028-04-01')).toEqual([]);
    });
  });

  describe('counts consistent with lists', () => {
    it('declared and not declared add up to expected, per section', () => {
      const document = tscFormM();
      document.partII.initial.declared = 11;
      document.partII.final.expected = 5;

      expect(problemPaths(document)).toEqual(['partII.initial.declared', 'partII.final.declared']);
    });

    it('the non-filers listed are as many as not declared', () => {
      const document = tscFormM();
      document.partII.biennial.nonFilers.pop();

      const problems = federatedRuleProblems(document, TODAY);

      expect(problems).toEqual([
        { path: 'partII.biennial.nonFilers', message: 'lists 4 officers; notDeclared is 5' },
      ]);
    });

    it('a year without a biennial cycle expects no biennial declarations', () => {
      const document = tscFormM();
      document.partII.biennial.noCycleInPeriod = true;

      expect(problemPaths(document)).toEqual(['partII.biennial.expected']);
    });

    it('access requests granted and declined are no more than received; reasons add up to declined', () => {
      const document = tscFormM();
      document.partII.accessRequests.granted = 5;
      document.partII.accessRequests.declineReasons = [
        { reason: 'prejudice-proceeding', count: 1 },
      ];

      expect(problemPaths(document)).toEqual([
        'partII.accessRequests.received',
        'partII.accessRequests.declineReasons',
      ]);
    });
  });

  describe('Part III present', () => {
    it('compiled by and confirmed by need a name and a date', () => {
      const document = tscFormM();
      document.partIII.compiledBy = { name: null, designation: null, date: '2028-07-08' };
      document.partIII.confirmedBy = { name: '  ', designation: 'Secretary', date: null };

      expect(problemPaths(document)).toEqual([
        'partIII.compiledBy.name',
        'partIII.confirmedBy.name',
        'partIII.confirmedBy.date',
      ]);
    });
  });

  it('the headline counts come from the document', () => {
    expect(reportCountsOf(tscFormM())).toEqual({
      initial: { expected: 12, declared: 10, notDeclared: 2 },
      biennial: { expected: 100, declared: 95, notDeclared: 5, noCycleInPeriod: false },
      final: { expected: 4, declared: 3, notDeclared: 1 },
      clarifications: 6,
      accessRequests: { received: 7, granted: 4, declined: 3 },
    });
  });
});
