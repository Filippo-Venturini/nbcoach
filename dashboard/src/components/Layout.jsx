import { NavLink, Link, Outlet, useNavigate } from 'react-router-dom'
import { Users, Home, Dumbbell, LogOut, FolderOpen, Settings } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

const navItems = [
  { to: '/',           label: 'HOME',         icon: Home,     end: true },
  { to: '/clients',    label: 'CLIENTI',      icon: Users },
  { to: '/catalog',    label: 'ESERCIZI',     icon: Dumbbell },
  { to: '/files',      label: 'FILE UTILI',   icon: FolderOpen },
  { to: '/settings',   label: 'IMPOSTAZIONI', icon: Settings },
]

export function Layout() {
  const { signOut, profile } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-navy-950 flex flex-col border-r border-navy-700 shrink-0">
        {/* Logo */}
        <div className="px-6 py-6 border-b border-navy-700">
          <Link to="/" className="font-heading font-bold italic text-2xl text-gold-500 hover:text-gold-400 transition-colors uppercase tracking-wider">
            FitCoach
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-6 py-3 text-sm font-heading font-bold italic uppercase tracking-wider transition-colors duration-150
                ${isActive
                  ? 'text-gold-500 bg-navy-800 border-l-2 border-gold-500'
                  : 'text-slate-400 hover:text-white hover:bg-navy-800 border-l-2 border-transparent'
                }`
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer sidebar */}
        <div className="border-t border-navy-700 p-4">
          {profile && (
            <p className="text-xs text-slate-500 mb-3 truncate px-2">
              {profile.full_name || profile.email}
            </p>
          )}
          <button onClick={handleLogout} className="btn-ghost w-full justify-start text-sm">
            <LogOut size={15} />
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-navy-900">
        <Outlet />
      </main>
    </div>
  )
}
