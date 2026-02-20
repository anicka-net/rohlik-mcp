import { RohlikAPI } from "../rohlik-api.js";

export function createAnnouncementsTool(createRohlikAPI: () => RohlikAPI) {
  return {
    name: "get_announcements",
    definition: {
      title: "Get Announcements",
      description: "Get current announcements and notifications from Rohlik",
      inputSchema: {}
    },
    handler: async () => {
      try {
        const api = createRohlikAPI();
        const announcements = await api.getAnnouncements();

        if (!announcements || (Array.isArray(announcements) && announcements.length === 0)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No announcements available."
              }
            ]
          };
        }

        const formatAnnouncements = (data: any): string => {
          if (Array.isArray(data)) {
            return `📢 ANNOUNCEMENTS:\n\n${data.map((announcement, index) => 
              `${index + 1}. ${announcement.title || 'Announcement'}
   ${announcement.message || announcement.content || announcement.text || 'No content'}
   ${announcement.date ? `Date: ${announcement.date}` : ''}`
            ).join('\n\n')}`;
          }
          
          if (data.title || data.message) {
            return `📢 ANNOUNCEMENT:
   ${data.title || 'Announcement'}
   ${data.message || data.content || data.text || 'No content'}
   ${data.date ? `Date: ${data.date}` : ''}`;
          }
          
          const json = JSON.stringify(data, null, 2);
          return `📢 ANNOUNCEMENTS:\n${json.length > 2000 ? json.slice(0, 2000) + '\n... (truncated)' : json}`;
        };

        const output = formatAnnouncements(announcements);

        return {
          content: [
            {
              type: "text" as const,
              text: output
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : String(error)
            }
          ],
          isError: true
        };
      }
    }
  };
}