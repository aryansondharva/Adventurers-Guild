/**
 * Bootcamp Pipeline — End-to-End Dry Run
 *
 * Validates every code path in the bootcamp pipeline with 5 test students:
 *   Step 1  — Onboard 5 students via /api/onboard webhook
 *   Step 2  — Quest visibility gating (INTERN blocked, real BOOTCAMP blocked until eligible)
 *   Step 3  — Tutorial Quest 1 full pipeline (claim → submit → QA approve → final approve → XP)
 *   Step 4  — Tutorial Quest 2 + eligibleForRealQuests unlocked
 *   Step 5  — Student can access real BOOTCAMP quests after both tutorials
 *   Step 6  — Party formation: 2-person BOOTCAMP party (full + reject 3rd)
 *   Step 7  — Rank-up verification: Student 1 should reach E-rank (F threshold 0, E threshold 1000)
 *
 * Prerequisites:
 *   • A running application (webServer in playwright.config.ts)
 *   • Seed admin account OR env vars E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD
 *   • BOOTCAMP_WEBHOOK_SECRET set in the app env (or matching E2E_BOOTCAMP_WEBHOOK_SECRET here)
 *
 * Environment variables (all optional — sensible dev defaults provided):
 *   E2E_ADMIN_EMAIL              defaults to admin@adventurersguild.com  (seed admin)
 *   E2E_ADMIN_PASSWORD           defaults to password123                  (seed admin)
 *   E2E_BOOTCAMP_WEBHOOK_SECRET  must match BOOTCAMP_WEBHOOK_SECRET in app env
 */

import { expect, test, type Browser, type BrowserContext } from '@playwright/test';

// ── Configuration ──────────────────────────────────────────────────────────────

// Access Node.js process safely — process is available at runtime in Playwright/Node
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _env = (typeof process !== 'undefined' ? process : { env: {} }) as { env: Record<string, string | undefined> };

const ADMIN_EMAIL = _env.env.E2E_ADMIN_EMAIL ?? 'admin@adventurersguild.com';
const ADMIN_PASSWORD = _env.env.E2E_ADMIN_PASSWORD ?? 'password123';
// Must match the BOOTCAMP_WEBHOOK_SECRET used by the running app instance
const WEBHOOK_SECRET = _env.env.E2E_BOOTCAMP_WEBHOOK_SECRET ?? _env.env.BOOTCAMP_WEBHOOK_SECRET ?? 'test-bootcamp-secret';
// Known password set on every test student via initialPassword in the onboard payload
const STUDENT_PASSWORD = 'BootcampDryRun1!';

const SUFFIX = Date.now();

// ── Shared state (serial execution, workers: 1) ────────────────────────────────

let adminContext: BrowserContext;

interface QuestIds {
  tutorial1: string;   // "Tutorial: First Blood …" — F-rank, 600 XP
  tutorial2: string;   // "Tutorial: Party Up …"    — E-rank, 600 XP
  realQuest: string;   // unlocked after both tutorials
  partyQuest: string;  // E-rank, maxParticipants=2, for Step 6
  internQuest: string; // INTERN track — must be blocked for bootcamp students
}
let questIds: QuestIds;

interface StudentInfo {
  id: string;
  email: string;
}
const students: StudentInfo[] = [];

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Log in via the UI and return an authenticated browser context. */
async function loginContext(browser: Browser, email: string, password: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  await page.close();
  return ctx;
}

/** POST to /api/admin/quests and return the new quest ID. */
async function createAdminQuest(
  ctx: BrowserContext,
  data: Record<string, unknown>,
): Promise<string> {
  const res = await ctx.request.post('/api/admin/quests', { data });
  const body = await res.json();
  expect(
    res.status(),
    `Failed to create quest "${data.title}": ${JSON.stringify(body)}`,
  ).toBe(201);
  return body.quest.id as string;
}

// ── Test suite ─────────────────────────────────────────────────────────────────

test.describe.serial('Bootcamp Pipeline — End-to-End Dry Run', () => {
  test.setTimeout(300_000);

  // ── Setup: admin login + quest creation ──────────────────────────────────────

  test.beforeAll(async ({ browser }) => {
    adminContext = await loginContext(browser, ADMIN_EMAIL, ADMIN_PASSWORD);

    const [t1Id, t2Id, realId, partyId, internId] = await Promise.all([
      // Tutorial Quest 1 — completes tutorialQuest1Complete on approval
      createAdminQuest(adminContext, {
        title: `Tutorial: First Blood ${SUFFIX}`,
        description: 'Bootcamp tutorial quest 1 — e2e dry run',
        questType: 'learning',
        difficulty: 'F',
        xpReward: 600,
        questCategory: 'backend',
        track: 'BOOTCAMP',
        source: 'TUTORIAL',
      }),
      // Tutorial Quest 2 — completes tutorialQuest2Complete + sets eligibleForRealQuests on approval
      createAdminQuest(adminContext, {
        title: `Tutorial: Party Up ${SUFFIX}`,
        description: 'Bootcamp tutorial quest 2 — e2e dry run',
        questType: 'learning',
        difficulty: 'E',
        xpReward: 600,
        questCategory: 'backend',
        track: 'BOOTCAMP',
        source: 'TUTORIAL',
      }),
      // Real BOOTCAMP quest — only accessible after both tutorials
      createAdminQuest(adminContext, {
        title: `Bootcamp Real Quest ${SUFFIX}`,
        description: 'Real BOOTCAMP quest unlocked after completing both tutorials',
        questType: 'commission',
        difficulty: 'F',
        xpReward: 300,
        questCategory: 'backend',
        track: 'BOOTCAMP',
        source: 'CLIENT_PORTAL',
      }),
      // E-rank party quest — used in Step 6
      createAdminQuest(adminContext, {
        title: `Bootcamp Party Formation Quest ${SUFFIX}`,
        description: 'E-rank BOOTCAMP quest for party formation dry run',
        questType: 'commission',
        difficulty: 'E',
        xpReward: 500,
        maxParticipants: 2,
        questCategory: 'fullstack',
        track: 'BOOTCAMP',
        source: 'CLIENT_PORTAL',
      }),
      // INTERN-track quest — must be blocked for bootcamp students regardless of eligibility
      createAdminQuest(adminContext, {
        title: `Intern Track Only Quest ${SUFFIX}`,
        description: 'INTERN-only quest — must return 403 for bootcamp students',
        questType: 'commission',
        difficulty: 'D',
        xpReward: 1000,
        questCategory: 'backend',
        track: 'INTERN',
        source: 'CLIENT_PORTAL',
      }),
    ]);

    questIds = {
      tutorial1: t1Id,
      tutorial2: t2Id,
      realQuest: realId,
      partyQuest: partyId,
      internQuest: internId,
    };
  });

  test.afterAll(async () => {
    if (adminContext) await adminContext.close();
  });

  // ── Step 1: Onboard 5 test students ──────────────────────────────────────────

  test('Step 1: Onboard 5 bootcamp test students via /api/onboard webhook', async ({ request }) => {
    for (let i = 1; i <= 5; i++) {
      const email = `bc.test${i}.${SUFFIX}@bootcamp.dev`;
      const res = await request.post('/api/onboard', {
        data: {
          name: `Bootcamp Test Student ${i} (${SUFFIX})`,
          email,
          bootcampStudentId: `BC-${SUFFIX}-${String(i).padStart(3, '0')}`,
          cohort: `e2e-cohort-${SUFFIX}`,
          bootcampTrack: 'beginner',
          bootcampWeek: 1,
          initialPassword: STUDENT_PASSWORD,
        },
        headers: {
          Authorization: `Bearer ${WEBHOOK_SECRET}`,
          'Content-Type': 'application/json',
        },
      });

      const body = await res.json();
      expect(res.status(), `Student ${i} onboard failed: ${JSON.stringify(body)}`).toBe(201);
      expect(body.success).toBe(true);
      expect(body.adventurerId).toBeTruthy();
      expect(body.rank).toBe('F');

      students.push({ id: body.adventurerId as string, email });
    }

    expect(students).toHaveLength(5);
  });

  // ── Step 1b: Re-onboard Student 1 is idempotent ──────────────────────────────

  test('Step 1b: Re-onboarding the same student is idempotent (no duplicate, no error)', async ({ request }) => {
    expect(students.length).toBeGreaterThan(0);

    const res = await request.post('/api/onboard', {
      data: {
        name: `Bootcamp Test Student 1 (${SUFFIX})`,
        email: students[0].email,
        bootcampStudentId: `BC-${SUFFIX}-001`,
        cohort: `e2e-cohort-${SUFFIX}`,
        bootcampTrack: 'beginner',
        bootcampWeek: 2, // week updated
        initialPassword: STUDENT_PASSWORD,
      },
      headers: {
        Authorization: `Bearer ${WEBHOOK_SECRET}`,
        'Content-Type': 'application/json',
      },
    });

    const body = await res.json();
    expect(res.status(), `Idempotent re-onboard failed: ${JSON.stringify(body)}`).toBe(200);
    expect(body.success).toBe(true);
    expect(body.adventurerId).toBe(students[0].id);
  });

  // ── Step 2: Quest visibility gating ──────────────────────────────────────────

  test('Step 2: Quest visibility is gated — bootcamp students only see BOOTCAMP/tutorial quests', async ({ browser }) => {
    expect(students.length).toBeGreaterThan(0);
    const studentCtx = await loginContext(browser, students[0].email, STUDENT_PASSWORD);

    try {
      // 2a: INTERN quest must return 403 (track restriction — not BOOTCAMP)
      const internRes = await studentCtx.request.get(`/api/quests/${questIds.internQuest}`);
      expect(internRes.status(), 'Expected 403 for INTERN quest').toBe(403);
      const internBody = await internRes.json();
      expect(internBody.error).toMatch(/access denied/i);

      // 2b: Real BOOTCAMP quest must return 403 (tutorial gating — not yet eligible)
      const realRes = await studentCtx.request.get(`/api/quests/${questIds.realQuest}`);
      expect(realRes.status(), 'Expected 403 for real BOOTCAMP quest before tutorials').toBe(403);
      const realBody = await realRes.json();
      expect(realBody.error).toMatch(/tutorial/i);

      // 2c: Tutorial quest (source=TUTORIAL) must be accessible
      const t1Res = await studentCtx.request.get(`/api/quests/${questIds.tutorial1}`);
      expect(t1Res.status(), 'Tutorial quest should be accessible').toBe(200);
      const t1Body = await t1Res.json();
      expect(t1Body.success).toBe(true);
      expect(t1Body.quest.track).toBe('BOOTCAMP');

      // 2d: Claiming a real BOOTCAMP quest must be blocked (tutorial gating in assignment service)
      const claimRealRes = await studentCtx.request.post('/api/quests/assignments', {
        data: { questId: questIds.realQuest },
      });
      expect(claimRealRes.status(), 'Should not be able to claim real quest before tutorials').toBe(403);
      const claimRealBody = await claimRealRes.json();
      expect(claimRealBody.error).toMatch(/tutorial/i);
    } finally {
      await studentCtx.close();
    }
  });

  // ── Step 3: Tutorial Quest 1 — full pipeline ──────────────────────────────────

  test('Step 3: Student 1 completes Tutorial Quest 1 through the full QA pipeline', async ({ browser }) => {
    expect(students.length).toBeGreaterThan(0);

    let assignmentId: string;
    let submissionId: string;

    const studentCtx = await loginContext(browser, students[0].email, STUDENT_PASSWORD);

    try {
      // 3a: Claim Tutorial Quest 1
      const claimRes = await studentCtx.request.post('/api/quests/assignments', {
        data: { questId: questIds.tutorial1 },
      });
      const claimBody = await claimRes.json();
      expect(claimRes.status(), `Claim tutorial 1 failed: ${JSON.stringify(claimBody)}`).toBe(201);
      expect(claimBody.success).toBe(true);
      assignmentId = claimBody.assignment.id as string;
      expect(claimBody.assignment.status).toBe('assigned');

      // 3b: Submit work
      const submitRes = await studentCtx.request.post('/api/quests/submissions', {
        data: {
          assignmentId,
          submissionContent: 'https://github.com/e2e-test/tutorial-first-blood',
          submissionNotes: 'E2E dry run: Tutorial First Blood submission',
        },
      });
      const submitBody = await submitRes.json();
      expect(submitRes.status(), `Submit tutorial 1 failed: ${JSON.stringify(submitBody)}`).toBe(201);
      expect(submitBody.success).toBe(true);
      submissionId = submitBody.submission.id as string;
    } finally {
      await studentCtx.close();
    }

    // 3c: Verify assignment is in the QA queue (admin view)
    const qaListRes = await adminContext.request.get('/api/admin/qa-queue');
    expect(qaListRes.status()).toBe(200);
    const qaListBody = await qaListRes.json();
    expect(qaListBody.success).toBe(true);
    const inQueue = (qaListBody.assignments as Array<{ id: string; status: string }>)
      .find((a) => a.id === assignmentId);
    expect(inQueue, 'Assignment should appear in QA queue after submission').toBeTruthy();
    expect(inQueue!.status).toBe('pending_admin_review');

    // 3d: Admin approves QA step (pending_admin_review → review)
    const qaApproveRes = await adminContext.request.patch(`/api/admin/qa-queue/${assignmentId}`, {
      data: { action: 'approve' },
    });
    expect(qaApproveRes.status(), 'QA approve step failed').toBe(200);
    const qaApproveBody = await qaApproveRes.json();
    expect(qaApproveBody.success).toBe(true);

    // 3e: Admin final approval of submission (review → completed + XP grant + tutorial tracking)
    const finalApproveRes = await adminContext.request.put('/api/quests/submissions', {
      data: {
        submissionId,
        status: 'approved',
        review_notes: 'E2E dry run — Tutorial First Blood approved',
        quality_score: 9,
      },
    });
    const finalBody = await finalApproveRes.json();
    expect(finalApproveRes.status(), `Final approval failed: ${JSON.stringify(finalBody)}`).toBe(200);
    expect(finalBody.success).toBe(true);
  });

  // ── Step 4: Tutorial Quest 2 + eligibility unlock ────────────────────────────

  test('Step 4: Student 1 completes Tutorial Quest 2 and gains real-quest eligibility', async ({ browser }) => {
    expect(students.length).toBeGreaterThan(0);

    let assignmentId: string;
    let submissionId: string;

    const studentCtx = await loginContext(browser, students[0].email, STUDENT_PASSWORD);

    try {
      // 4a: Claim Tutorial Quest 2
      const claimRes = await studentCtx.request.post('/api/quests/assignments', {
        data: { questId: questIds.tutorial2 },
      });
      const claimBody = await claimRes.json();
      expect(claimRes.status(), `Claim tutorial 2 failed: ${JSON.stringify(claimBody)}`).toBe(201);
      assignmentId = claimBody.assignment.id as string;

      // 4b: Submit work
      const submitRes = await studentCtx.request.post('/api/quests/submissions', {
        data: {
          assignmentId,
          submissionContent: 'https://github.com/e2e-test/tutorial-party-up',
          submissionNotes: 'E2E dry run: Tutorial Party Up submission',
        },
      });
      const submitBody = await submitRes.json();
      expect(submitRes.status(), `Submit tutorial 2 failed: ${JSON.stringify(submitBody)}`).toBe(201);
      submissionId = submitBody.submission.id as string;
    } finally {
      await studentCtx.close();
    }

    // 4c: Admin QA approve
    const qaRes = await adminContext.request.patch(`/api/admin/qa-queue/${assignmentId}`, {
      data: { action: 'approve' },
    });
    expect(qaRes.status()).toBe(200);

    // 4d: Admin final approve — triggers eligibleForRealQuests = true
    const approveRes = await adminContext.request.put('/api/quests/submissions', {
      data: {
        submissionId,
        status: 'approved',
        review_notes: 'E2E dry run — Tutorial Party Up approved',
        quality_score: 9,
      },
    });
    const approveBody = await approveRes.json();
    expect(approveRes.status(), `Tutorial 2 final approval failed: ${JSON.stringify(approveBody)}`).toBe(200);
    expect(approveBody.success).toBe(true);
  });

  // ── Step 5: Real BOOTCAMP quest access after tutorials ────────────────────────

  test('Step 5: Student 1 can access and claim real BOOTCAMP quests after completing both tutorials', async ({ browser }) => {
    expect(students.length).toBeGreaterThan(0);

    // Fresh login — JWT will carry updated rank/xp from DB
    const studentCtx = await loginContext(browser, students[0].email, STUDENT_PASSWORD);

    try {
      // 5a: Real BOOTCAMP quest must now be accessible
      const realRes = await studentCtx.request.get(`/api/quests/${questIds.realQuest}`);
      expect(realRes.status(), 'Real BOOTCAMP quest should be accessible after tutorials').toBe(200);
      const realBody = await realRes.json();
      expect(realBody.success).toBe(true);
      expect(realBody.quest.track).toBe('BOOTCAMP');

      // 5b: Student can claim the real quest
      const claimRes = await studentCtx.request.post('/api/quests/assignments', {
        data: { questId: questIds.realQuest },
      });
      const claimBody = await claimRes.json();
      expect(claimRes.status(), `Claim real quest failed: ${JSON.stringify(claimBody)}`).toBe(201);
      expect(claimBody.assignment.status).toBe('assigned');

      // 5c: INTERN quest must still be blocked (track restriction is absolute)
      const internRes = await studentCtx.request.get(`/api/quests/${questIds.internQuest}`);
      expect(internRes.status(), 'INTERN quest must remain inaccessible to bootcamp students').toBe(403);
    } finally {
      await studentCtx.close();
    }
  });

  // ── Step 6: Party formation ───────────────────────────────────────────────────

  test('Step 6: Student 1 forms a 2-person BOOTCAMP party and Student 2 joins; adding a 3rd is rejected', async ({ browser }) => {
    expect(students.length).toBeGreaterThanOrEqual(3);

    // Student 1 has E-rank after tutorial completions; re-login to get updated JWT
    const student1Ctx = await loginContext(browser, students[0].email, STUDENT_PASSWORD);

    try {
      // 6a: Student 1 creates a party for the E-rank party quest
      const createPartyRes = await student1Ctx.request.post('/api/parties', {
        data: { questId: questIds.partyQuest },
      });
      const partyBody = await createPartyRes.json();
      expect(createPartyRes.status(), `Party creation failed: ${JSON.stringify(partyBody)}`).toBe(201);
      expect(partyBody.success).toBe(true);

      const party = partyBody.party;
      expect(party.leaderId).toBe(students[0].id);
      expect(party.maxSize).toBe(2); // BOOTCAMP cap
      expect(party.track).toBe('BOOTCAMP');
      expect(party.members).toHaveLength(1);
      expect(party.members[0].userId).toBe(students[0].id);
      expect(party.members[0].isLeader).toBe(true);

      const partyId = party.id as string;

      // 6b: Student 1 adds Student 2 (both are bootcamp-enrolled)
      const addMemberRes = await student1Ctx.request.post(`/api/parties/${partyId}/members`, {
        data: { userId: students[1].id },
      });
      const addMemberBody = await addMemberRes.json();
      expect(addMemberRes.status(), `Add member failed: ${JSON.stringify(addMemberBody)}`).toBe(201);
      expect(addMemberBody.success).toBe(true);

      const updatedParty = addMemberBody.party;
      expect(updatedParty.members).toHaveLength(2);
      const memberIds = (updatedParty.members as Array<{ userId: string }>).map((m) => m.userId);
      expect(memberIds).toContain(students[0].id);
      expect(memberIds).toContain(students[1].id);

      // 6c: Party is now full — adding Student 3 must be rejected
      const addExtraRes = await student1Ctx.request.post(`/api/parties/${partyId}/members`, {
        data: { userId: students[2].id },
      });
      expect(addExtraRes.status(), 'Party is full — 3rd member must be rejected').toBe(400);
      const extraBody = await addExtraRes.json();
      expect(extraBody.error).toMatch(/full/i);
    } finally {
      await student1Ctx.close();
    }
  });

  // ── Step 7: Rank-up verification ─────────────────────────────────────────────

  test('Step 7: Student 1 rank-up from F to E after earning ≥1000 XP via tutorial completions', async () => {
    expect(students.length).toBeGreaterThan(0);

    // Use the admin API to inspect Student 1's state — avoids session-less getServerSession edge cases
    const usersRes = await adminContext.request.get(
      `/api/admin/users?search=${encodeURIComponent(students[0].email)}&limit=1`,
    );
    expect(usersRes.status()).toBe(200);
    const usersBody = await usersRes.json();
    expect(usersBody.success).toBe(true);

    const user = (usersBody.users as Array<{ id: string; rank: string; xp: number }>)
      .find((u) => u.id === students[0].id);
    expect(user, 'Student 1 should be found in admin user list').toBeTruthy();

    // Tutorial 1: 600 XP + Tutorial 2: 600 XP = 1200 XP → E-rank (threshold: 1000)
    expect(user!.xp, 'Student 1 XP should be ≥ 1000 after two tutorial completions').toBeGreaterThanOrEqual(1000);
    expect(user!.rank, 'Student 1 should have ranked up to E').toBe('E');
  });
});
