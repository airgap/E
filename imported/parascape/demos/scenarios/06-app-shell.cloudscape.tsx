import { useState } from 'react';
import AppLayout from '@cloudscape-design/components/app-layout';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import HelpPanel from '@cloudscape-design/components/help-panel';
import SideNavigation from '@cloudscape-design/components/side-navigation';

export default function AppShellCloudscape() {
	const [active, setActive] = useState('/dashboard');
	const [navOpen, setNavOpen] = useState(true);
	const [toolsOpen, setToolsOpen] = useState(false);
	return (
		<AppLayout
			navigationOpen={navOpen}
			onNavigationChange={({ detail }) => setNavOpen(detail.open)}
			toolsOpen={toolsOpen}
			onToolsChange={({ detail }) => setToolsOpen(detail.open)}
			navigation={
				<SideNavigation
					activeHref={active}
					header={{ text: 'Console', href: '/' }}
					items={[
						{ type: 'link', text: 'Dashboard', href: '/dashboard' },
						{ type: 'link', text: 'Instances', href: '/instances' },
						{ type: 'link', text: 'Volumes', href: '/volumes' },
						{
							type: 'section',
							text: 'Network',
							items: [
								{ type: 'link', text: 'VPCs', href: '/vpcs' },
								{ type: 'link', text: 'Subnets', href: '/subnets' },
							],
						},
					]}
					onFollow={({ detail }) => detail.href && setActive(detail.href)}
				/>
			}
			tools={<HelpPanel header={<h2>Help</h2>}>Tips for this page go here.</HelpPanel>}
			content={
				<ContentLayout header={<Header variant="h1">Dashboard</Header>}>
					<Container header={<Header variant="h2">Welcome</Header>}>
						The page body sits in a Container under the ContentLayout header.
					</Container>
				</ContentLayout>
			}
		/>
	);
}
