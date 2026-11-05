// Bid board on the phone: every tender package across projects, then the saved bidder lists. Online, read only.
import { useQuery } from '@tanstack/react-query';
import { Text } from 'react-native';
import { ListItem, Screen, fontWeight, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { companyNames, getBidBoard, listBidderLists } from '../commands';
import { boardSubtitle, listSubtitle } from '../format';

export function BidBoardScreen() {
  const t = useTheme();
  const { orgId } = useCurrentOrg();
  const board = useQuery({
    queryKey: ['bid-board', orgId],
    queryFn: () => getBidBoard(api, orgId!),
    enabled: orgId !== null,
  });
  const lists = useQuery({
    queryKey: ['bid-board', orgId, 'lists'],
    queryFn: () => listBidderLists(api, orgId!),
    enabled: orgId !== null,
  });
  // Names are a nicety: a failure leaves the counts.
  const names = useQuery({
    queryKey: ['bid-board', orgId, 'company-names'],
    queryFn: () => companyNames(api, orgId!),
    enabled: orgId !== null,
    staleTime: 5 * 60_000,
  });

  if (!orgId) {
    return (
      <Screen title="Bid board">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (board.isPending || lists.isPending) {
    return (
      <Screen title="Bid board">
        <StateMessage loading message="Loading the bid board" />
      </Screen>
    );
  }
  if (board.isError || lists.isError) {
    return (
      <Screen title="Bid board">
        <StateMessage
          tone="danger"
          message="Could not load the bid board. It is for builder staff, and needs a connection."
          onRetry={() => {
            void board.refetch();
            void lists.refetch();
          }}
        />
      </Screen>
    );
  }
  const heading = {
    color: t.color.text,
    fontSize: t.font.size.lg,
    fontWeight: fontWeight(t.font.weight.semibold),
  };
  const nameMap = names.data ?? new Map<string, string>();
  return (
    <Screen title="Bid board">
      <Text accessibilityRole="header" style={heading}>
        Tender packages
      </Text>
      {board.data.data.length === 0 ? (
        <StateMessage message="No tender packages yet. Create them on a project's Estimating tool." />
      ) : null}
      {board.data.data.map((e) => (
        <ListItem key={e.id} title={`${e.numberLabel}  ${e.name}`} subtitle={boardSubtitle(e)} />
      ))}
      {board.data.truncated ? (
        <StateMessage message="Showing the first 500 packages. Use the web to filter." />
      ) : null}
      <Text accessibilityRole="header" style={heading}>
        Bidder lists
      </Text>
      {lists.data.length === 0 ? (
        <StateMessage message="No bidder lists yet. Make them on the web." />
      ) : null}
      {lists.data.map((l) => (
        <ListItem key={l.id} title={l.name} subtitle={listSubtitle(l, nameMap)} />
      ))}
    </Screen>
  );
}
