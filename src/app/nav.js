// Sidebar sections and the routes behind them (pages in router.js). Section order
// Queries, Data, Contacts, Automation, Journeys, Content (feedback #128, regrouped in
// the redesign, #1031). `hidden` pages have a route but no sidebar entry.
import {
  Bookmark, LayoutGrid, Blocks, Workflow, ListChecks, Database, Route, LogIn, Globe, Mail, Network, Trash2, LayoutTemplate, LayoutDashboard, Users, HardDrive, FilePlus2, History, MailCheck, Footprints, House, FileClock, ShieldCheck, Package, Newspaper, CalendarClock, Send, Zap, BellRing, MailOpen, UserCog, UserSearch, UserX, Share2, ArchiveRestore, FileInput, SlidersHorizontal, Building2, ShieldBan, MessageSquareText, Eraser, FolderInput, LibraryBig, MailWarning, Activity } from 'lucide-vue-next'

export const NAV_GROUPS = [
  // Home (feedback #1025): the start page, in a group without a heading.
  { label: '', items: [{ path: '/home', name: 'Home', icon: House }] },
  {
    label: 'Queries',
    items: [
      { path: '/queries/workspace', name: 'Run Query', icon: LayoutGrid },
      { path: '/queries/builder', name: 'Query Builder', icon: Blocks },
      { path: '/queries/saved', name: 'Saved queries', icon: Bookmark },
      { path: '/queries/starter', name: 'Starter queries', icon: LibraryBig },
    ],
  },
  {
    label: 'Data',
    items: [
      { path: '/data-extensions', name: 'Data Extensions', icon: Database },
      { path: '/create-de', name: 'Create DE', icon: FilePlus2 },
      { path: '/where-used', name: 'Where used', icon: Network },
      { path: '/de-storage', name: 'DE storage', icon: HardDrive },
      // Deleted data extensions and Content Builder items, read-only (user, 2026-11-10).
      { path: '/recycle-bin', name: 'Recycle bin', icon: ArchiveRestore },
    ],
  },
  {
    label: 'Contacts',
    items: [
      { path: '/contacts', name: 'Contacts', icon: Users },
      { path: '/email-validation', name: 'Email validation', icon: MailCheck },
      // Subscribers per list and status (feedback #1080).
      { path: '/publication-lists', name: 'Publication Lists', icon: Newspaper },
      // User, 2026-11-10: why a person gets no email, contact deletions, Data Designer.
      { path: '/subscribers', name: 'Subscriber lookup', icon: UserSearch },
      { path: '/contact-deletions', name: 'Contact deletions', icon: UserX },
      { path: '/data-model', name: 'Data model', icon: Share2 },
      // API ideas 16 and 17 (user, 2026-11-11): suppression lists, MobileConnect subscriptions.
      { path: '/suppression-lists', name: 'Suppression lists', icon: ShieldBan },
      { path: '/sms-subscriptions', name: 'SMS subscriptions', icon: MessageSquareText },
    ],
  },
  {
    label: 'Automation',
    items: [
      { path: '/automation-overview', name: 'Automation overview', icon: LayoutDashboard },
      { path: '/automations', name: 'Automations', icon: Workflow },
      { path: '/activities', name: 'Activities', icon: ListChecks },
      { path: '/saved-activities', name: 'Saved Activities', icon: History },
      { path: '/templates', name: 'Templates', icon: LayoutTemplate },
      { path: '/import-results', name: 'Import results', icon: FileInput },
    ],
  },
  {
    label: 'Journeys',
    items: [
      { path: '/journey-overview', name: 'Journey overview', icon: LayoutDashboard },
      { path: '/journeys', name: 'Journeys', icon: Route },
      { path: '/journey-entry', name: 'Journey Entry', icon: LogIn },
      // Moved from Contacts (feedback #1088); same route.
      { path: '/contact-journeys', name: 'Contact journeys', icon: Footprints },
    ],
  },
  {
    label: 'Content',
    items: [
      { path: '/emails', name: 'Emails', icon: Mail },
      { path: '/cloudpages', name: 'CloudPages', icon: Globe },
      // What was created or modified, by whom, in a period (feedback #1087).
      { path: '/content/changes', name: 'Changes', icon: CalendarClock },
      // Read-only report of what could be tidied (API idea 18, Mathes, 2026-11-11).
      { path: '/content/cleanup', name: 'Clean-up report', icon: Eraser },
    ],
  },
  // Sending (user, 2026-11-10): read-only lookups of transactional messaging, triggered
  // sends, email sends and Event Notification Service registrations.
  {
    label: 'Sending',
    items: [
      { path: '/transactional', name: 'Transactional messages', icon: Send },
      { path: '/triggered-sends', name: 'Triggered sends', icon: Zap },
      { path: '/sends', name: 'Sends', icon: MailOpen },
      { path: '/send-problems', name: 'Send problems', icon: MailWarning },
      { path: '/engagement-events', name: 'Engagement events', icon: Activity },
      { path: '/event-notifications', name: 'Event notifications', icon: BellRing },
      { path: '/send-settings', name: 'Send settings', icon: SlidersHorizontal },
    ],
  },
  // Setup (user, 2026-11-05): sender authentication, From addresses and custom domains;
  // installed packages with their secrets, API endpoints and Automation Studio access
  // (was Account under Settings, feedback #1078).
  {
    label: 'Setup',
    items: [
      { path: '/domains', name: 'Domains', icon: ShieldCheck },
      { path: '/installed-packages', name: 'Installed Packages', icon: Package },
      { path: '/users', name: 'Users and roles', icon: UserCog },
      { path: '/business-units', name: 'Business units', icon: Building2 },
      // File locations and the activities that use them (API idea 20, Mathes, 2026-11-11).
      { path: '/file-locations', name: 'File locations', icon: FolderInput },
    ],
  },
  // Saved Emails and Saved CloudPages are tabs of Emails and CloudPages (feedback #1059);
  // still routes and Ctrl+K entries.
  {
    label: 'Content', hidden: true,
    items: [
      { path: '/emails/saved', name: 'Saved Emails', icon: History },
      { path: '/cloudpages/saved', name: 'Saved CloudPages', icon: FileClock, props: { kind: 'cloudpage' } },
    ],
  },
  // Delete Toolkit runs moved under Settings as Clean up (redesign, #1031).
  { label: 'Settings', hidden: true, items: [{ path: '/queries/cleanup', name: 'Clean up', icon: Trash2 }] },
]

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })))
