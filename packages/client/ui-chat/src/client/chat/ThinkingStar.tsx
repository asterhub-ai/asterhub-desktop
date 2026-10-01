import css from './ChatView.module.css'

/** The animated AsterHub-style spark shown while the assistant is thinking. */
export function ThinkingStar() {
  return (
    <svg className={css.thinkingStar} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path className={css.thinkingStarMain} d="M12 1.8L14.8 9.2L22.2 12L14.8 14.8L12 22.2L9.2 14.8L1.8 12L9.2 9.2L12 1.8Z" />
      <path className={css.thinkingStarAccent} d="M19.2 16.6L20.1 19L22.5 19.9L20.1 20.8L19.2 23.2L18.3 20.8L15.9 19.9L18.3 19L19.2 16.6Z" />
    </svg>
  )
}
