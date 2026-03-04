# SPHAiRDigital

**One Platform. Every Task.**

SPHAiRDigital is a **multi-tenant SaaS platform** that hosts multiple companies, each with their own isolated data and customizable configurations. It is a professional, centralized digital O&M system designed to optimize solar power plant maintenance operations. The platform is asset-centric, user-friendly, backend-validated, and fully auditable, providing complete control, efficiency, and visibility over all maintenance and operational workflows.

## Platform Architecture

**SPHAiRDigital is a platform that hosts companies.**

### Route Structure

The platform uses a dual-route architecture to separate platform-level administration from tenant-specific operations:

#### `/platform/*` - Platform Routes (System Admin)
- **Purpose**: System-wide administration and management
- **Access**: System owners only (`system_owner` role)
- **Data Scope**: All organizations, all users, all data (no filtering)
- **Use Case**: Manage the entire platform without entering a specific company

**Platform Routes Include:**
- `/platform/dashboard` - Platform overview dashboard (all organizations)
- `/platform/organizations` - Manage all organizations
- `/platform/users` - Manage all users across all organizations
- `/platform/system-settings` - Platform-wide settings
- `/platform/analytics` - Cross-organization analytics

#### `/tenant/*` - Tenant Routes (Company-Specific)
- **Purpose**: Company-specific operations and data
- **Access**: All authenticated users (filtered by their organization)
- **Data Scope**: Only the user's organization data (RLS filtering active)
- **Header Display**: Shows company abbreviation (e.g., "SIE" for Smart Innovations Energy)
- **Use Case**: Day-to-day operations within a specific company

**Tenant Routes Include:**
- `/tenant/dashboard` - Company-specific dashboard
- `/tenant/tasks` - Company tasks
- `/tenant/inventory` - Company inventory
- `/tenant/calendar` - Company calendar
- `/tenant/plant` - Company plant management
- All other operational routes

### Platform Dashboard (What System Owners See Without Entering a Company)

When system owners log in, they see the **Platform Dashboard** (`/platform/dashboard`) which provides:

- **System Overview**:
  - Total number of organizations
  - Total users across all organizations
  - Total assets across all organizations
  - Total tasks across all organizations
  - System health metrics

- **Organization Management**:
  - List of all organizations
  - Quick access to organization details
  - Organization status (active/inactive)
  - User counts per organization

- **Quick Actions**:
  - Create new organization
  - Manage organizations
  - View system-wide analytics
  - Access platform settings

### Entering a Company (Deliberate Action)

**"Enter Company" is a deliberate action, not default behavior.**

- System owners start at the Platform Dashboard (`/platform/dashboard`)
- To work within a specific company, they must explicitly **"Enter Company"**
- This switches context to tenant routes (`/tenant/*`)
- Header shows company abbreviation (e.g., "SIE")
- All operations are scoped to that company
- Can switch back to platform view at any time

**Benefits:**
- Clear separation between platform administration and company operations
- Prevents accidental cross-company data access
- Makes platform management the primary view for system owners
- Company entry is intentional and tracked

### Data Isolation Strategy

**Application-Level Filtering** (Not RLS-based for system owners):

- **System Owners**: 
  - RLS is bypassed in application code
  - Can see all data when in platform routes
  - Filtered by organization when in tenant routes
  - Full control over data access

- **Regular Users**:
  - RLS policies active
  - Always filtered by their `organization_id`
  - Cannot access other organizations' data
  - Secure data isolation maintained

## About SPHAiRDigital

SPHAiRDigital is the name of the whole platform we are building. It hosts multiple companies, each with their own isolated data and configurations. Companies that subscribe to SPHAiRDigital may customize the branding to their company name (e.g., "SIE Management System").

## Overview

This application replaces paper-based PM and CM checklists with a structured, dynamic, and auditable digital system. The system tracks maintenance tasks, validates checklist responses on the backend, and automatically generates Corrective Maintenance tasks when Preventive Maintenance fails.

## System Purpose & Goal

The primary purpose of this system is to:
- **Digitize Maintenance Operations**: Replace paper-based checklists with a comprehensive digital solution
- **Ensure Accountability**: Track who performed tasks, when, and with what results through complete audit trails
- **Automate Workflows**: Automatically generate Corrective Maintenance tasks when Preventive Maintenance fails
- **Maintain Quality Standards**: Enforce pass/fail validation on the backend to ensure consistency and reliability
- **Streamline Operations**: Provide efficient, user-friendly interfaces for all maintenance activities
- **Enhance Security**: Implement single-device-per-session access control to prevent unauthorized access and maintain session integrity

## Offline Functionality

SPHAiRDigital includes comprehensive offline support, allowing users to continue working even when internet connectivity is unavailable. When the device reconnects to the internet, all offline operations are automatically synchronized with the server.

### Key Features

- **Offline Task Management**: Users can start, pause, resume, and complete tasks while offline
- **Offline Checklist Submission**: Checklist responses can be submitted offline and synced when connection is restored
- **Automatic Sync**: When the device comes back online, all pending operations are automatically synchronized
- **Visual Indicators**: The system displays clear indicators showing connection status and sync progress
- **Data Persistence**: All offline data is stored locally using IndexedDB, ensuring data is not lost even if the browser is closed

### How It Works

1. **Offline Detection**: The system automatically detects when the device goes offline
2. **Request Queuing**: When offline, all API requests are queued locally instead of being sent to the server
3. **Local Storage**: Task data and operations are stored in IndexedDB for offline access
4. **Automatic Sync**: When connection is restored, the sync manager automatically processes all queued operations
5. **Conflict Resolution**: The system handles conflicts and ensures data integrity during sync

### Supported Offline Operations

- Task start/pause/resume/complete
- Checklist response submission
- Task creation (queued for sync)
- Inventory updates (queued for sync)

### Offline Indicator

The system displays a status indicator at the top of the screen showing:
- **Offline Mode**: When the device is offline
- **Syncing**: When operations are being synchronized
- **Pending Count**: Number of operations waiting to be synced
- **Sync Status**: Success/failure information after sync completes

### Technical Implementation

- **IndexedDB**: Used for local data storage and sync queue management
- **Service Worker**: Provides offline caching and network interception
- **Sync Manager**: Handles automatic synchronization when connection is restored
- **Offline API Wrapper**: Intercepts API calls and queues them when offline

## Core Principle: User-Friendly Usability

**User-friendly usability is the primary design principle of this system.** Every feature, update, and improvement must prioritize user experience, especially on mobile devices. This includes:

- **Intuitive Navigation**: Clear and consistent UI patterns throughout the application
- **Mobile-First Design**: Optimized layouts and interactions for mobile users
- **Automated Actions**: Reducing manual steps (e.g., auto-scrolling to relevant sections)
- **Responsive Feedback**: Immediate visual feedback for user actions
- **Accessibility**: Ensuring the app is usable by all users regardless of device or ability
- **Minimal Cognitive Load**: Reducing the number of decisions users need to make
- **Efficient Workflows**: Streamlining common tasks to require fewer clicks and less scrolling
- **Professional Quality & Neatness**: Maintaining clean, consistent spacing, properly sized UI elements, and a polished appearance that reflects quality craftsmanship. Unnecessary text and spacing should be minimized, with error messages and hints shown only when relevant. The UI should demonstrate attention to detail and professional standards in both desktop and mobile layouts.
- **Expert-Level Professionalism**: The system must maintain a professional, expert-level appearance at all times. Emojis, casual symbols, and unprofessional visual elements are strictly avoided. All UI elements should use professional text labels, clear typography, and appropriate visual indicators that convey competence and expertise. The system should demonstrate that it was built by experts, not beginners, through its clean, professional, and polished interface.
- **Mobile and Desktop Correspondence**: When updating or implementing any feature, styling, or layout change, always ensure that both mobile and laptop/desktop views correspond appropriately. This means maintaining proportional sizing, consistent spacing ratios, and equivalent functionality across all device sizes. Mobile and desktop should feel like the same application, just optimized for different screen sizes.

**All future development should always consider: "How can we make this more user-friendly, maintain the highest quality standards, demonstrate expert-level professionalism, and ensure mobile and desktop views correspond appropriately?"** These principles take precedence over technical complexity or shortcuts. The quality of the UI should reflect the quality of the system builder and demonstrate expertise through a clean, professional, and polished appearance across all devices.

## Alignment with System Purpose

**Every improvement, update, addition, or subtraction must align with the system's purpose and goals.** Before implementing any change, consider:

1. **Does it enhance maintenance operations?** - All features should directly or indirectly support the core mission of digitizing and managing maintenance tasks
2. **Does it improve accountability and auditing?** - Changes should maintain or improve the system's ability to track who did what, when, and why
3. **Does it streamline workflows?** - New features should reduce manual steps and make maintenance tasks more efficient
4. **Does it maintain data integrity?** - All changes must preserve the system's validation and reliability standards
5. **Does it serve the user community?** - Features must benefit technicians, supervisors, and administrators in their daily work
6. **Does it align with professional standards?** - All additions must meet the expert-level quality and professionalism requirements

**Before implementing any change, ask: "Does this align with the system's purpose of digitizing maintenance operations, ensuring accountability, automating workflows, and maintaining quality standards?"** If a feature, improvement, or update doesn't clearly support these goals, it should be reconsidered or reframed to better serve the system's core mission.

## Features

### Core Functionality
- **Dynamic Checklist Engine**: No hard-coded checklist fields - all checklists are defined in the database
- **Interactive Checklist Structure Editor**: Full in-app editor for modifying checklist sections and items
- **Template Management**: Upload Excel/Word files, create, edit, and delete templates directly in the system
- **Location-Based Tasks**: Tasks are created with location information instead of asset-specific assignments
- **Backend-Driven Validation**: Pass/fail logic is enforced on the server, not in the UI
- **Automatic CM Generation**: Failed PM tasks automatically generate CM tasks and letters
- **Audit Trails**: Complete tracking of who performed tasks, when, and results
- **Task Management**: Separate pages for PM (Preventive Maintenance) and Inspection tasks
- **Organization-Specific Templates**: Each organization has its own set of checklist templates (no shared system templates)

### Plant Management
- **Interactive Plant Map (Site Map)**: Visual representation of the solar plant with tracker blocks. The map title is static ("Site Map") for all organizations.
- **Company-Scoped Map Data**: Map structure is loaded only from organization-specific files (`uploads/companies/{slug}/plant/map-structure.json`); no localStorage fallback, ensuring data isolation between tenants.
- **Dual View Modes**: Switch between Grass Cutting and Panel Wash views
- **Tracker Status Tracking**: Multi-select trackers and submit status requests (Done/Halfway)
- **Admin Approval Workflow**: Tracker status changes require admin/superadmin approval. Approvals and cycle reset both read/write map data from file first for consistency.
- **Progress Tracking**: Real-time progress bars showing completion percentage for each work type
- **Visual Status Indicators**: Color-coded tracker blocks (White=Not Done, Green=Done, Orange=Halfway)
- **Map Reload**: Map refreshes automatically on tracker approval (via `trackerStatusApproved` event), when returning to the Plant page, and on window focus.
- **Clean Button**: Resets the current cycle and clears all tracker colors to white. Visible to System Owner and Operations Administrator only (next to the progress bar).
- **Cycle Tracking System**: Track maintenance cycles for Grass Cutting and Panel Washing
  - Cycles increment automatically when tasks reach 100% completion
  - Cycle reset clears both grass-cutting and panel-wash colors for all trackers
  - Historical data stored with month-level detail for year-end analysis
  - Cycle reset functionality for authorized users (admin/superadmin)
  - Cycle information displayed on Plant page and included in PDF reports
  - Prevents selection of completed (green) trackers for better workflow management

### Inventory Management
- **Spare Parts Tracking**: Complete inventory management with minimum level alerts
- **Section-Based Organization**: Items organized by location/section with visual indicators
- **Low Stock Warnings**: Blinking caution icons for items below minimum quantity
- **Spares Usage Tracking**: Date-range filtered usage reports
- **Stock Level Monitoring**: Visual highlighting for items at minimum or below minimum levels

### Calendar & Scheduling
- **Year Calendar View**: Complete annual view of all scheduled tasks
- **Auto-Navigation**: Calendar automatically displays the current month on load
- **Task Frequency Support**: Daily, Weekly, Monthly, Quarterly, Bi-Monthly, and Annual frequencies
- **Outstanding Tasks Highlighting**: Visual indicators for overdue or outstanding tasks
- **Calendar Event Management**: Automatic generation and tracking of scheduled maintenance

### CM Letters & Reporting
- **Automated CM Letter Generation**: Automatic creation of corrective maintenance letters from failed PMs
- **Fault Log Reports**: Comprehensive fault log generation with date range filtering
- **Report Downloads**: Excel-based reports with proper formatting and data mapping
- **CM Letter Status Tracking**: Track CM letters from open to resolved status

### Notifications System
- **Real-Time Notifications**: In-app notification system with idempotency protection (prevents duplicates)
- **Auto-Mark as Read**: Notifications automatically marked as read when viewed or interacted with
- **Category Filtering**: Filter notifications by Tasks, Tracker Status, Early Completion, or Other
- **Date Grouping**: Notifications grouped by "Today", "Yesterday", or full date
- **Admin Review Interface**: Admins can review and approve/reject tracker status requests
- **Overtime Request Notifications**: Automatic notifications for overtime work acknowledgement
- **Task Assignment Notifications**: Notifications for task assignments and updates
- **Professional UI**: Clean, professional interface using React Icons library

### User Management & Security
- **Advanced Role-Based Access Control (RBAC)**: Six granular roles with permission-based access:
  - **System Owner**: Full system control and access to all features
  - **Operations Administrator**: Day-to-day operations management, template management, user management
  - **Supervisor**: Task oversight, approval workflows, team management
  - **Technician**: Task execution, checklist completion, field work
  - **General Worker**: Basic task execution and viewing
  - **Inventory Controller**: Inventory management and spares tracking
- **Granular Permissions**: Access defined by responsibility, not just title
- **Single-Device-Per-Session Security**: Users can only access from one device at a time
- **Two-Tier Inactivity Timeout**: 
  - **Work-Active Timeout** (2-4 hours): Extended timeout when user has active tasks, recent work, or API activity
  - **Idle Timeout** (45 minutes): Standard security timeout for inactive sessions
- **Password Management**: Forced password change on first login
- **User Profile Management**: Complete user profile and account management
- **Rate Limiting**: Production-grade rate limiting to prevent brute force and abuse:
  - General API: 100 requests per 15 minutes
  - Authentication: 5 login attempts per 15 minutes
  - Sensitive operations: 10 requests per hour
- **File Upload Security**: Magic number validation to prevent MIME type spoofing attacks
- **Structured Logging**: Winston-based logging with daily rotation, sanitization, and environment-aware output
- **Standardized Error Handling**: Custom error classes for consistent API error responses

### Offline Support
- **Offline Task Management**: Start, pause, resume, and complete tasks offline
- **Offline Checklist Submission**: Submit checklist responses without internet
- **Automatic Sync**: All offline operations sync when connection is restored
- **Visual Offline Indicators**: Clear status indicators for connection and sync state

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: React (PWA) with React Icons
- **Database**: PostgreSQL (with JSONB for flexible data structures)
- **Session Management**: Redis (required in production) for single-device-per-session
- **File Processing**: 
  - Excel: `exceljs` for parsing `.xlsx` and `.xls` files
  - Word: `mammoth` for parsing `.docx` files
- **Logging**: Winston for structured logging with daily rotation
- **Testing**: Jest with Supertest for unit and integration testing
- **Deployment**: Docker + Docker Compose
- **Update Service**: Secure authenticated updates (no backdoors)
- **Security**: Role-based access control with granular permissions, rate limiting, file validation

## Deployment

SPHAiRDigital supports secure, automated deployment with:

- **Docker Deployment**: Containerized deployment with Docker Compose
- **Secure Update Mechanism**: Authenticated remote updates (requires service token)
- **CI/CD Pipeline**: GitHub Actions workflow included
- **Multi-Client Support**: Shared or dedicated infrastructure options
- **Health Monitoring**: Built-in health checks and status endpoints

For deployment instructions, see:
- **[Complete Deployment Guide](./DEPLOYMENT_GUIDE_SINGLE_COMPANY.md)** - Step-by-step deployment guide with pricing and all details
- **API**: RESTful APIs

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- Redis (required for production, optional for development)
- npm or yarn

## Installation

### 1. Install Dependencies

```bash
npm run install-all
```

This will install dependencies for the root, server, and client.

### 2. Database Setup

**Moving to another PC?** See [docs/SETUP_POSTGRES_OTHER_PC.md](docs/SETUP_POSTGRES_OTHER_PC.md) for PostgreSQL setup and run steps on a new machine.

1. Make sure PostgreSQL is running on your system
2. Update database credentials in `server/.env`:
   ```
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=solar_om_db
   DB_USER=postgres
   DB_PASSWORD=your_password
   ```

3. Run the database setup script:
   ```bash
   cd server
   npm run setup-db
   ```

This will:
- Create the database if it doesn't exist
- Create all required tables including RBAC tables (roles, permissions, role_permissions, user_roles)
- Run all database migrations
- Seed initial data including:
  - Default System Owner and Operations Administrator users
  - 13 pre-configured checklist templates (imported from Excel files)
  - RBAC roles and permissions

### 3. Start the Application

From the root directory:

```bash
npm run dev
```

This will start:
- Backend server on `http://localhost:3001`
- Frontend app on `http://localhost:3000`

Or start them separately:

```bash
# Terminal 1 - Backend
npm run server

# Terminal 2 - Frontend
npm run client
```

## Project Structure

```
ChecksheetsApp/
├── server/                 # Backend API
│   ├── db/                # Database schema
│   ├── routes/            # API routes
│   ├── utils/             # Utility functions (validation)
│   ├── scripts/           # Setup scripts
│   └── index.js           # Server entry point
├── client/                # Frontend React app
│   ├── public/            # Static files
│   └── src/               # React source code
│       ├── components/    # React components
│       ├── api/           # API client
│       └── App.js         # Main app component
├── Sphair/                # Marketing website
│   ├── index.html         # Main landing page
│   ├── pricing.html       # Pricing page
│   ├── assets/            # CSS, JS, images, vendor files
│   ├── server.js          # Preview server
│   └── README.md          # Marketing site documentation
├── Checksheets/           # Original checklist documents
└── package.json           # Root package.json
```

## Marketing Website

SPHAiRDigital includes a professional marketing website located in the `Sphair/` folder. This static website serves as the public-facing marketing site for the platform.

### Website Structure

- **Domain Structure**:
  - `sphairdigital.com` → Marketing website (Sphair folder)
  - `sphairdigital.com/app` → Actual software application

### Pages

- **index.html** - Main landing page featuring:
  - Hero section with animated color transitions (red to blue)
  - About section with key statistics
  - Services overview (PM, CM, Plant Map, Inventory, Scheduling, Reporting)
  - Call-to-action sections
  - Contact information

- **pricing.html** - Pricing and subscription plans:
  - Three pricing tiers (Starter, Professional, Enterprise)
  - Monthly/Yearly billing toggle
  - Feature comparison
  - FAQ section

### Design Features

- **Color Scheme**: Red (#DC2626) and Blue (#2563EB) branding
- **Animations**: Smooth color fade animations in hero section
- **Responsive**: Fully responsive design for all devices
- **SEO Optimized**: Proper meta tags and semantic HTML
- **Professional**: Clean, modern design focused on solar plant maintenance

### Preview Locally

```bash
cd Sphair
node server.js
```

Then open http://localhost:8081 in your browser.

For more details, see [Sphair/README.md](./Sphair/README.md).

## Database Schema

### Core Tables

- **users**: System users with role information
- **roles**: RBAC roles (system_owner, operations_admin, supervisor, technician, general_worker, inventory_controller)
- **permissions**: System permissions (templates:create, users:read, etc.)
- **role_permissions**: Mapping of roles to permissions
- **user_roles**: User role assignments
- **assets**: Physical assets (weather stations, inverters, etc.)
- **checklist_templates**: Dynamic checklist definitions with JSONB structure
- **tasks**: PM/CM task instances
- **checklist_responses**: Submitted checklist data
- **cm_letters**: Corrective maintenance letters
- **tracker_status_requests**: Tracker status change requests with approval workflow
- **tracker_cycles**: Current cycle tracking for Grass Cutting and Panel Washing tasks
- **tracker_cycle_history**: Historical cycle data with month-level detail for year-end analysis
- **notifications**: In-app notifications with idempotency keys
- **inventory_items**: Spare parts inventory
- **plant_map_structure**: Plant map layout and tracker configurations

## Checklist Templates

**Important: Multi-Tenant Template System**

SPHAiRDigital uses a **multi-tenant architecture** where **each company (organization) has its own set of checklist templates**. There are **NO shared system templates** - each organization manages and owns their templates independently.

### Template Ownership

- **Each organization has its own templates**: Templates are scoped to a specific organization via `organization_id`
- **No system templates**: All templates belong to an organization - there are no global/shared templates
- **Template isolation**: Organizations can only see and manage their own templates
- **Template customization**: Each organization can create, modify, and delete their own templates without affecting other organizations

### Default Organization

The default organization "Smart Innovations Energy" includes 13 pre-configured checklist templates covering various maintenance activities:

1. **CC-PM-004** - Concentrated Cabinet Inspection (Monthly)
2. **CCTV-PM-ANNUAL** - CCTV Annual Inspection
3. **CCTV-PM-MONTHLY** - CCTV Monthly Inspection
4. **CT-MV-PM-008** - CT MV Inspection (Monthly)
5. **EM-PM-014** - Energy Meter Inspection (Monthly)
6. **INV-PM-006** - Inverter Inspection (Monthly)
7. **SCADA-STRINGS-PM-003** - SCADA Strings Monitoring (Weekly)
8. **SCADA-TRACKERS-PM-005** - SCADA Trackers Monitoring (Weekly)
9. **SCB-PM-003** - String Combiner Box Inspection (Bi-Monthly)
10. **SUB-BATTERIES-PM-021** - Substation Batteries Inspection (Monthly)
11. **SUB-PM-020** - Substation Inspection (Monthly)
12. **TRACKER-PM-005** - Tracker Inspection (Quarterly)
13. **VENT-PM-009** - Ventilation Inspection (Weekly)

**Note**: When creating a new organization, templates can be cloned from an existing organization (e.g., Smart Innovations Energy) as a starting point, but each organization maintains independent template ownership.

Templates can be imported from Excel files in `server/templates/excel/` and managed through the web interface.

## Usage

### Creating a Task

1. Navigate to **Tasks** → **PM** or **Tasks** → **Inspection**
2. Click **Create New Task**
3. Fill in:
   - Checklist Template (select from available templates)
   - Location (text input for task location)
   - Assigned Users (can assign to multiple users)
   - Task Type (PM or CM)
   - Scheduled Date
   - Budgeted Hours (optional, Super Admin only)

### Executing a Task

1. View the task from the Tasks list
2. Click **Start Task** to begin
3. Click **Fill Checklist** to complete the checklist form
4. Submit the checklist (validation happens on backend)
5. Click **Complete Task** to finish

### Overtime Work Acknowledgement

When users start or complete tasks outside normal working hours (07:00-16:00), the system automatically:
- Creates an overtime request for acknowledgement
- Sends a notification to all super admins
- Tracks the overtime work for record-keeping purposes

Super admins can:
- View all overtime requests in the system
- Approve (acknowledge) overtime work
- Reject overtime requests with a reason (if needed)

This provides proof of extra hours worked and ensures proper documentation of after-hours maintenance activities.

### Automatic CM Generation

When a PM task is completed with `overall_status = 'fail'`:
- A new CM task is automatically created
- A CM letter is generated with issue description
- The CM task is linked to the failed PM task

## Security Features

### Single-Device-Per-Session

SPHAiRDigital implements **single-device-per-session** security to enhance application security and maintain accountability:

- **One Active Session**: Each user can only have one active session at a time across all devices
- **Automatic Session Invalidation**: When a user logs in from a new device, the previous session is automatically invalidated
- **Enhanced Security**: Prevents unauthorized access if credentials are compromised on one device
- **Accountability**: Ensures accurate tracking of which device a user is accessing the system from
- **Session Integrity**: Prevents conflicts when updating data from multiple devices simultaneously

**How it works:**
- On login, the system checks for existing active sessions for the user
- If an existing session is found, it is automatically invalidated
- The new session becomes the active session for that user
- All subsequent requests validate that the token matches the active session
- On logout, the active session is cleared, allowing login from any device

**Note**: This feature requires Redis to be enabled (`REDIS_ENABLED=true`). In production, Redis is required and the server will exit if Redis is unavailable. In development, the system gracefully degrades if Redis is unavailable, allowing multiple sessions (backward compatibility).

### Two-Tier Inactivity Timeout

SPHAiRDigital implements an intelligent inactivity timeout system:

- **Work-Active Timeout (2-4 hours)**: Extended timeout applies when:
  - User has active tasks (`in_progress` or `paused` status)
  - User has unsaved drafts in local storage
  - Task started within last 2 hours
  - Recent API activity (within last 10 minutes)
  
  This prevents logout during active field work while maintaining security.

- **Idle Timeout (45 minutes)**: Standard security timeout applies when:
  - User has no active work context
  - No recent task activity
  - No recent API activity
  
- **Warning Modal**: System displays a 5-minute warning before logout, allowing users to extend their session

This two-tier approach balances security with usability, ensuring field workers aren't interrupted during active maintenance tasks.

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login user (creates new session, invalidates previous)
- `POST /api/auth/logout` - Logout user (clears active session)
- `GET /api/auth/me` - Get current user session

### Tasks
- `GET /api/tasks` - List all tasks
- `GET /api/tasks/:id` - Get task details
- `POST /api/tasks` - Create new task
- `PATCH /api/tasks/:id/start` - Start a task (automatically creates overtime request if outside working hours)
- `PATCH /api/tasks/:id/complete` - Complete a task (automatically creates overtime request if outside working hours)

### Overtime Requests
- `GET /api/overtime-requests` - List all overtime requests (System Owner/Operations Administrator only)
- `PATCH /api/overtime-requests/:id/approve` - Approve/acknowledge an overtime request
- `PATCH /api/overtime-requests/:id/reject` - Reject an overtime request

### Checklist Responses
- `POST /api/checklist-responses` - Submit checklist response
- `GET /api/checklist-responses?task_id=:id` - Get responses for a task

### Checklist Templates
- `GET /api/checklist-templates` - List all checklist templates
- `GET /api/checklist-templates/:id` - Get template details
- `POST /api/checklist-templates/upload` - Upload Excel/Word template file
- `POST /api/checklist-templates` - Create new template
- `PUT /api/checklist-templates/:id` - Update template (metadata and structure)
- `DELETE /api/checklist-templates/:id` - Delete template

### CM Letters
- `GET /api/cm-letters` - List CM letters
- `GET /api/cm-letters/:id` - Get CM letter details
- `PATCH /api/cm-letters/:id/status` - Update CM letter status
- `GET /api/cm-letters/fault-log/download` - Download fault log report (with date range filtering)

### Plant Map
- `GET /api/plant/structure` - Get plant map structure
- `POST /api/plant/structure` - Save plant map structure
- `POST /api/plant/tracker-status-request` - Submit tracker status request (requires admin approval)
- `GET /api/plant/tracker-status-requests` - Get tracker status requests (admin only)
- `PATCH /api/plant/tracker-status-request/:id` - Approve/reject tracker status request (admin only)
- `GET /api/plant/cycles/:task_type` - Get current cycle information for Grass Cutting or Panel Washing
- `POST /api/plant/cycles/:task_type/reset` - Reset cycle (admin/superadmin only)
- `GET /api/plant/cycles/:task_type/history` - Get cycle history with month-level detail
- `GET /api/plant/cycles/:task_type/stats` - Get cycle statistics

### Inventory
- `GET /api/inventory/items` - Get inventory items
- `GET /api/inventory/spares-usage` - Get spares usage (with date range filtering)
- `POST /api/inventory/update` - Update inventory quantities
- `POST /api/inventory/items` - Create new inventory item
- `PUT /api/inventory/items/:id` - Update inventory item

### Notifications
- `GET /api/notifications` - Get user notifications (with category and date filtering)
- `GET /api/notifications/unread-count` - Get unread notification count
- `PATCH /api/notifications/:id/read` - Mark notification as read
- `PATCH /api/notifications/read-all` - Mark all notifications as read

### Users & RBAC
- `GET /api/users` - List all users (System Owner/Operations Administrator only)
- `POST /api/users` - Create new user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user
- `GET /api/users/roles` - Get all available roles
- `GET /api/users/:id/rbac` - Get user's roles and permissions
- `POST /api/users/:id/roles` - Assign roles to user

### Calendar
- `GET /api/calendar/events` - Get calendar events
- `POST /api/calendar/events` - Create calendar event
- `PUT /api/calendar/events/:id` - Update calendar event
- `DELETE /api/calendar/events/:id` - Delete calendar event
- `GET /api/calendar/download` - Download year calendar (Excel format)

See individual route files for complete API documentation.

## Development

### Backend Development

```bash
cd server
npm run dev  # Uses nodemon for auto-reload
```

### Frontend Development

```bash
cd client
npm start  # React development server with hot reload
```

## Testing

### Running Tests

```bash
cd server
npm test              # Run all tests
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

### Testing Locally

1. Ensure PostgreSQL is running (and Redis for production features)
2. Run database setup: `cd server && npm run setup-db`
3. Start the application: `npm run dev`
4. Open browser to `http://localhost:3000`
5. Login with default credentials (if implemented) or use the API directly

### Test Coverage

The system includes tests for:
- Error handling and custom error classes
- Critical utility functions
- Additional route tests (can be expanded)

## Default Data

After running `setup-db`, you'll have:

- **Users**:
  - System Owner account (with `system_owner` role) - check setup script for credentials
  - Operations Administrator account (with `operations_admin` role)
  - Additional roles and users can be created through the web interface

- **Checklist Templates**:
  - Each organization has its own templates (no shared system templates)
  - Templates are scoped to organizations via `organization_id`
  - Templates can be imported from Excel files or created through the web interface
  - All templates include complete checklist structures with sections and items

- **RBAC System**:
  - 6 pre-configured roles with appropriate permissions
  - Permission system ready for granular access control

## Template Management

### Web-Based Template Management

Templates can be managed directly through the web interface (System Owner and Operations Administrator only):

- **Upload Templates**: Upload Excel (`.xlsx`, `.xls`) or Word (`.docx`) files - the system automatically extracts checklist structure
- **Create Templates**: Manually create templates with custom checklist structures
- **Edit Templates**: 
  - Update metadata (name, description, frequency, asset type)
  - Edit checklist structure directly using the built-in structure editor (add/remove sections and items, reorder, update titles)
- **Delete Templates**: Remove templates that are no longer needed

### Checklist Structure Editor

The built-in structure editor allows you to:
- Add/remove sections and items
- Update section titles and item descriptions
- Reorder sections and items (drag-and-drop)
- Edit item properties inline
- Save changes directly to the database

### Command-Line Template Management

For bulk operations, you can also use command-line scripts:

#### Updating All Templates from Excel Files

```bash
cd server
node scripts/update-all-excel-templates.js
```

This script:
- Reads all `.xlsx` files from `server/templates/excel/`
- Extracts template codes (e.g., EM-PM-014) and frequencies from the files
- Updates or inserts templates in the database
- Maintains proper template code format: `{PREFIX}-PM-{NUMBER}`

#### Cleaning Up Old Templates

To remove templates that are no longer in the Excel folder:

```bash
cd server
node scripts/cleanup-old-templates.js
```

#### Plant Map: Full Tracker Reset (Wipe Approvals)

To remove all tracker status requests/approvals and reset all organizations’ map trackers to white (clean state):

```bash
cd server
node scripts/wipe-tracker-approvals.js
```

This script deletes tracker status requests and related notifications, then resets each organization’s `map-structure.json` (and database) so all trackers show white. Use for a fresh start or after testing.

### Template File Support

The system supports:
- **Excel Files**: `.xlsx`, `.xls` - Automatically extracts sections, items, metadata, and frequencies
- **Word Files**: `.docx` - Extracts text content and attempts to parse into checklist structure

Templates are stored with their complete structure in JSONB format, making them fully dynamic and editable without code changes.

## Role-Based Access Control (RBAC)

SPHAiRDigital uses a comprehensive RBAC system with six defined roles:

### System Owner
- Full system control and access to all features
- Can assign System Owner role to other users
- Can manage all templates, users, and system settings

### Operations Administrator
- Day-to-day operations management
- Can create, update, and delete templates
- Can manage users (except System Owner role assignment)
- Full access to tasks, inventory, and reporting

### Supervisor
- Task oversight and approval workflows
- Can view and manage team tasks
- Can approve/reject tracker status requests
- Access to notifications and calendar
- Cannot manage templates or users

### Technician
- Task execution and checklist completion
- Can start, pause, resume, and complete tasks
- Can submit checklist responses
- Access to plant map and notifications
- Read-only access to most other features

### General Worker
- Basic task execution
- Can complete assigned tasks
- Limited access to system features
- Cannot view templates page

### Inventory Controller
- Inventory management and spares tracking
- Can update inventory quantities
- Can create and edit inventory items
- Access to spares usage reports
- Cannot view templates page

### Permission-Based Access

Access is defined by permissions (e.g., `templates:create`, `templates:update`, `templates:delete`, `users:read`, `users:create`, `plant:approve_status`), not just roles. This allows for granular control and easy extension with additional roles or permissions.

## Production Features

### Rate Limiting

SPHAiRDigital implements comprehensive rate limiting to protect against brute force attacks and API abuse:

- **Standard API Endpoints**: 100 requests per 15 minutes per IP/user
- **Authentication Endpoints**: 5 login attempts per 15 minutes per IP
- **Sensitive Operations**: 10 requests per hour (user creation, password changes)
- **Configurable**: All limits can be adjusted via environment variables
- **Development Override**: Can be disabled via `DISABLE_RATE_LIMITING=true` for development

Rate limits return HTTP 429 (Too Many Requests) with `Retry-After` headers indicating when to retry.

### File Upload Security

The system uses magic number (file signature) validation to prevent MIME type spoofing:

- **Validation**: File types are verified using file signatures, not just extensions or MIME types
- **Supported Types**: JPEG, PNG, GIF, WebP
- **Automatic Rejection**: Invalid files are automatically deleted before storage
- **Security**: Prevents malicious files disguised as images from being uploaded

### Structured Logging

Production-ready logging system using Winston:

- **Log Levels**: Error, Warn, Info, Debug (environment-aware)
- **Daily Rotation**: Logs are automatically rotated daily and compressed
- **Sensitive Data Sanitization**: Passwords, tokens, and sensitive fields are automatically redacted
- **Multiple Outputs**: Console (development) and file (production)
- **30-Day Retention**: Error and combined logs retained for 30 days

### Standardized Error Handling

Consistent error responses across the API:

- **Custom Error Classes**: `ValidationError`, `AuthenticationError`, `NotFoundError`, etc.
- **Structured Responses**: All errors return consistent JSON format with error codes
- **Stack Traces**: Hidden in production, visible in development
- **Global Handler**: Centralized error handling middleware

### Redis Requirement (Production)

In production environments, Redis is mandatory:

- **Session Storage**: Required for single-device-per-session enforcement
- **Token Management**: JWT token validation and revocation
- **Server Exit**: Server will exit on startup if Redis is unavailable in production
- **Development**: Optional in development (fallback to memory store)

Configure via:
```
REDIS_ENABLED=true
REDIS_URL=redis://localhost:6379
```

## License

ISC

