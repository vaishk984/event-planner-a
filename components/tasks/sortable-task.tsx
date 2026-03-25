'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Task } from '@/lib/types/task'
import { TaskCard } from './task-card'

interface SortableTaskProps {
    task: Task
    onMarkComplete?: (taskId: string) => void
}

export function SortableTask({ task, onMarkComplete }: SortableTaskProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: task.id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
    }

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <TaskCard task={task} onMarkComplete={onMarkComplete} />
        </div>
    )
}
