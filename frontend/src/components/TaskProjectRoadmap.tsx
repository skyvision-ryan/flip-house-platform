import { useEffect, useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import { api, type Project } from '../api/client';
import { m, systemText } from '../i18n/core';
import { useLanguage } from '../i18n/LanguageProvider';
import StepsPanel from './StepsPanel';
import ExpandableSection from './ui/ExpandableSection';
export default function TaskProjectRoadmap({ projectId, refreshKey, onChanged }: { projectId: number; refreshKey: string; onChanged: () => void }) {
  useLanguage(); const [project, setProject] = useState<Project | null>(null); const [error, setError] = useState('');
  useEffect(() => { let active = true; api.project(projectId).then(p => { if (active) { setProject(p); setError(''); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [projectId, refreshKey]);
  return <ExpandableSection headerText={m('taskWorkflow.roadmap')} headerDescription={m('taskWorkflow.roadmapHint')} variant="container">
    {error && <Alert type="error">{systemText(error)}</Alert>}
    {project && <StepsPanel projectId={projectId} refreshKey={refreshKey} onChanged={onChanged} schedule={{ start: project.construction_start, end: project.construction_end, active: project.stage === 'active' }} />}
  </ExpandableSection>;
}
