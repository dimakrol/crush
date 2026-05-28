import { useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { friendlyError } from '../services/errorMessages'

type Mode = 'login' | 'register'

interface AuthModalProps {
  initialMode?: Mode
  onClose: () => void
}

export function AuthModal({ initialMode = 'login', onClose }: AuthModalProps) {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isRegister = mode === 'register'

  function validate(): string | null {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.'
    if (isRegister && password.length < 8) return 'Password must be at least 8 characters.'
    if (!password) return 'Enter your password.'
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      if (isRegister) await register(email, password)
      else await login(email, password)
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-gray-800 border border-gray-700 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex gap-1 rounded-lg bg-gray-900 p-1">
          {(['login', 'register'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m)
                setError(null)
              }}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                mode === m ? 'bg-yellow-400 text-gray-900' : 'text-gray-400 hover:text-white'
              }`}
            >
              {m === 'login' ? 'Log In' : 'Sign Up'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-gray-300">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="rounded-lg bg-gray-900 border border-gray-600 px-3 py-2 text-white focus:border-yellow-400 focus:outline-none"
              placeholder="you@example.com"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-300">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              className="rounded-lg bg-gray-900 border border-gray-600 px-3 py-2 text-white focus:border-yellow-400 focus:outline-none"
              placeholder={isRegister ? 'At least 8 characters' : '••••••••'}
            />
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 rounded-lg bg-yellow-400 py-2.5 font-semibold text-gray-900 hover:bg-yellow-300 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Please wait…' : isRegister ? 'Create Account' : 'Log In'}
          </button>
        </form>
      </div>
    </div>
  )
}
