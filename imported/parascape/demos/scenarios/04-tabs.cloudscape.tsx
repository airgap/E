import { useState } from 'react';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tabs from '@cloudscape-design/components/tabs';

export default function TabsCloudscape() {
	const [active, setActive] = useState('overview');
	return (
		<Container header={<Header variant="h2">order-1024</Header>}>
			<Tabs
				activeTabId={active}
				onChange={({ detail }) => setActive(detail.activeTabId)}
				tabs={[
					{
						id: 'overview',
						label: 'Overview',
						content: (
							<KeyValuePairs
								columns={2}
								items={[
									{
										label: 'Status',
										value: <StatusIndicator type="success">Paid</StatusIndicator>,
									},
									{ label: 'Customer', value: 'acme.corp' },
									{ label: 'Total', value: '$1,248.00' },
									{ label: 'Items', value: '12' },
								]}
							/>
						),
					},
					{
						id: 'items',
						label: 'Items',
						content: <Box>List of order items goes here.</Box>,
					},
					{
						id: 'shipping',
						label: 'Shipping',
						content: <Box>Shipping events go here.</Box>,
					},
				]}
			/>
		</Container>
	);
}
