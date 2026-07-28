import {
  keepPreviousData,
  useQuery,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

export const TABLE_REFRESH_INTERVAL_MILLISECONDS = 15_000;

export function useTableQuery<QueryData>({
  queryKey,
  queryFunction,
}: {
  queryKey: QueryKey;
  queryFunction: () => Promise<QueryData>;
}) {
  return useQuery({
    queryKey,
    queryFn: queryFunction,
    placeholderData: keepPreviousData,
    refetchInterval: TABLE_REFRESH_INTERVAL_MILLISECONDS,
    refetchIntervalInBackground: false,
  });
}

export function refreshTableData(
  queryClient: QueryClient,
  queryKey: QueryKey,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey });
}
