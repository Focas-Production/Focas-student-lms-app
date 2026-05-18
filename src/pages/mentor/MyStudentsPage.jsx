export default function MyStudentsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Students</h1>
        <p className="text-gray-400 text-sm mt-1">Students assigned to you will appear here</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-4">
        {/* Placeholder rows */}
        {[1, 2, 3].map(i => (
          <div key={i} className={`flex items-center gap-4 px-5 py-4 ${i < 3 ? 'border-b border-gray-50' : ''}`}>
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 bg-gray-100 rounded w-32" />
              <div className="h-3 bg-gray-100 rounded w-24" />
            </div>
            <div className="h-6 w-16 bg-gray-100 rounded-full" />
          </div>
        ))}
      </div>

      <div className="bg-teal-50 border border-teal-100 rounded-2xl p-6 text-center">
        <div className="w-14 h-14 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-7 h-7 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        </div>
        <p className="text-teal-800 font-semibold mb-1">No students assigned yet</p>
        <p className="text-teal-600 text-sm leading-relaxed">
          Contact your administrator to have students assigned to your mentor account.
        </p>
      </div>
    </div>
  )
}
