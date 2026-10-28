// Sidebar sections and the routes behind them (pages in router.js). Section order
// Queries, Data, Automation, Journey, Content (feedback #128).
import {
  Bookmark, LayoutGrid, Blocks, Workflow, ListChecks, Database, Route, LogIn, Globe, Mail, Network, Trash2, LayoutTemplate, LayoutDashboard, Users, HardDrive, FilePlus2, History,
} from 'lucide-vue-next'

export const NAV_GROUPS = [
  {
    label: 'Queries',
    items: [
      { path: '/queries/saved', name: 'Saved queries', icon: Bookmark },
      { path: '/queries/workspace', name: 'Run Query', icon: LayoutGrid },
      { path: '/queries/builder', name: 'Query Builder', icon: Blocks },
      { path: '/queries/cleanup', name: 'Delete Toolkit runs', icon: Trash2 },
    ],
  },
  {
    label: 'Data',
    items: [
      { path: '/data-extensions', name: 'Data Extensions', icon: Database },
      { path: '/create-de', name: 'Create DE', icon: FilePlus2 },
      { path: '/where-used', name: 'Where used', icon: Network },
      { path: '/de-storage', name: 'DE storage', icon: HardDrive },
      { path: '/contacts', name: 'Contacts', icon: Users },
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
    ],
  },
  {
    label: 'Journey',
    items: [
      { path: '/journey-overview', name: 'Journey overview', icon: LayoutDashboard },
      { path: '/journeys', name: 'Journeys', icon: Route },
      { path: '/journey-entry', name: 'Journey Entry', icon: LogIn },
    ],
  },
  {
    label: 'Content',
    items: [
      { path: '/cloudpages', name: 'CloudPages', icon: Globe },
      { path: '/emails', name: 'Saved Emails', icon: Mail },
    ],
  },
]

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })))
