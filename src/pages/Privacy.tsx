import { LegalShell, LegalSection } from "./legal-shell";

/**
 * Aria Privacy Policy. Plain-language, honest about exactly what the app
 * stores and why — including the in-browser git engine, the offline draft
 * buffer, and the AI assistant. Replace the placeholder contact details
 * before launch.
 */
export default function Privacy() {
  return (
    <LegalShell title="Privacy Policy" updated="August 14, 2026">
      <LegalSection heading="What we collect">
        <p>
          <strong>Account information.</strong> When you sign in we store your
          email address, name, and avatar so we can recognize you across
          devices.
        </p>
        <p>
          <strong>GitHub connection.</strong> When you connect GitHub we store
          an OAuth access token on our servers. It is used only to call GitHub
          on your behalf (reading repos, listing files, and creating commits,
          branches, and pull requests you ask for). It is never exposed to
          your browser, never used for any other purpose, and can be revoked
          by disconnecting GitHub from the app or from GitHub's settings.
        </p>
        <p>
          <strong>Workspace data.</strong> The repositories you open, branches,
          files you view, and unsaved edits are stored so your work continues
          across devices. This includes file content, cursor positions, and
          your most recent workspace location.
        </p>
        <p>
          <strong>Usage data.</strong> We count AI assistant requests per
          account per billing period to enforce your plan's quota. We do not
          use your file contents to train models.
        </p>
        <p>
          <strong>Billing.</strong> Payments are processed by Stripe; we never
          see your card details. We store only your subscription status and
          billing period.
        </p>
      </LegalSection>

      <LegalSection heading="Where your data lives">
        <p>
          Data is stored on our serverless cloud provider (Convex). Code you
          commit is stored by GitHub and governed by GitHub's own terms. When
          you use the AI assistant, the code snippet you ask about is sent to
          our AI provider to generate a response; it is not stored by Aria
          beyond the in-chat transcript.
        </p>
      </LegalSection>

      <LegalSection heading="Local storage">
        <p>
          The app uses your browser's local storage for things that must work
          offline or instantly: your login session, an offline buffer of
          unsaved edits (synced to the server when you're back online),
          editor preferences, and which optional plugins you've installed.
          These stay on your device.
        </p>
        <p>
          The in-browser git engine stores cloned repositories in your
          browser's IndexedDB. That data exists only on your device and can be
          removed by clearing site data.
        </p>
      </LegalSection>

      <LegalSection heading="Retention">
        <p>
          Unsaved drafts are kept until you commit or delete them. Live
          presence sessions expire automatically within minutes of your tab
          closing. One-time authorization codes expire after ten minutes.
          Billing and audit records are retained as long as required by law or
          for legitimate business purposes.
        </p>
      </LegalSection>

      <LegalSection heading="Sharing">
        <p>
          We never sell your data. We share it only with the services Aria is
          built on and only as far as needed to operate: the serverless
          backend that stores it, GitHub for the operations you request, and
          Stripe for payments.
        </p>
      </LegalSection>

      <LegalSection heading="Security">
        <p>
          GitHub tokens are stored server-side and never sent to your browser.
          We scan staged changes for secret-like content (API keys, private
          keys, .env files) and refuse to commit them without your explicit
          confirmation. Traffic is encrypted in transit.
        </p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>
          You can export your drafts and workspace data at any time, delete
          your account, or ask us to delete or correct your data. Contact us
          at{" "}
          <a
            href="mailto:privacy@arialabs.dev"
            className="underline underline-offset-2"
          >
            privacy@arialabs.dev
          </a>{" "}
          or write to Aria Labs (Karan Kotwal and Shivam Kotwal), 2825 Azad
          Nagar, Ranjhi, Jabalpur, Madhya Pradesh 482005, India — and we'll
          respond within 30 days.
        </p>
        <p>
          If you're in the EU/UK, this policy is your record of processing
          under GDPR; you also have the right to lodge a complaint with your
          supervisory authority.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          If we change this policy in a way that matters, we'll update the
          "Last updated" date above and, for significant changes, notify you
          in the app.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
