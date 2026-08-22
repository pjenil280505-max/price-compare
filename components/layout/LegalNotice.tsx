/**
 * Standard footer notice on every policy page.
 *
 * These pages accurately describe what the software does — that part is
 * verifiable from the code. They are NOT a lawyer-drafted agreement, and
 * saying otherwise would itself be an unsupported legal claim. Being
 * explicit protects the operator far better than boilerplate that implies
 * a review which never happened.
 */
export function LegalNotice() {
  return (
    <p className="rounded-lg border border-saffron-300 bg-saffron-50 p-4 text-sm dark:border-saffron-700/40 dark:bg-saffron-700/10">
      <strong className="font-semibold text-ink dark:text-paper">Notice:</strong> this page
      accurately describes how this service currently works, but it has not been reviewed by a
      lawyer and is not legal advice. It does not necessarily satisfy every obligation that may
      apply to you — including under India&apos;s Digital Personal Data Protection Act, the
      Consumer Protection (E-Commerce) Rules, or ASCI guidance on disclosing paid links. Have these
      pages reviewed before operating this service publicly.
    </p>
  );
}
