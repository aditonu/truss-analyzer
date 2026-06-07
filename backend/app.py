from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
from scipy.linalg import solve
import json

app = Flask(__name__)
CORS(app)  # Allow requests from React frontend

class TrussAnalyzer:
    def __init__(self):
        self.nodes = {}
        self.members = []
        self.forces = {}
        self.supports = {}
        self.E = 200e9  # Young's modulus (Pa) - Steel
        self.A = 0.01   # Cross-sectional area (m²)
    
    def add_node(self, node_id, x, y):
        self.nodes[node_id] = {'x': x, 'y': y}
    
    def add_member(self, member_id, node1, node2):
        self.members.append({
            'id': member_id,
            'node1': node1,
            'node2': node2
        })
    
    def add_support(self, node_id, support_type):
        self.supports[node_id] = support_type
    
    def add_force(self, node_id, fx, fy):
        self.forces[node_id] = {'fx': fx, 'fy': fy}
    
    def get_member_length(self, node1, node2):
        x1, y1 = self.nodes[node1]['x'], self.nodes[node1]['y']
        x2, y2 = self.nodes[node2]['x'], self.nodes[node2]['y']
        length = np.sqrt((x2-x1)**2 + (y2-y1)**2)
        return length
    
    def get_member_angle(self, node1, node2):
        x1, y1 = self.nodes[node1]['x'], self.nodes[node1]['y']
        x2, y2 = self.nodes[node2]['x'], self.nodes[node2]['y']
        angle = np.arctan2(y2-y1, x2-x1)
        return angle
    
    def build_stiffness_matrix(self):
        n_nodes = len(self.nodes)
        n_dof = n_nodes * 2
        K_global = np.zeros((n_dof, n_dof))
        
        for member in self.members:
            node1 = member['node1']
            node2 = member['node2']
            
            L = self.get_member_length(node1, node2)
            angle = self.get_member_angle(node1, node2)
            
            c = np.cos(angle)
            s = np.sin(angle)
            k = (self.E * self.A) / L
            
            k_local = k * np.array([
                [c*c, c*s, -c*c, -c*s],
                [c*s, s*s, -c*s, -s*s],
                [-c*c, -c*s, c*c, c*s],
                [-c*s, -s*s, c*s, s*s]
            ])
            
            dof1_x = node1 * 2
            dof1_y = node1 * 2 + 1
            dof2_x = node2 * 2
            dof2_y = node2 * 2 + 1
            
            dofs = [dof1_x, dof1_y, dof2_x, dof2_y]
            
            for i, dof_i in enumerate(dofs):
                for j, dof_j in enumerate(dofs):
                    K_global[dof_i, dof_j] += k_local[i, j]
        
        return K_global
    
    def build_load_vector(self):
        n_nodes = len(self.nodes)
        F = np.zeros(n_nodes * 2)
        
        for node_id, force in self.forces.items():
            dof_x = node_id * 2
            dof_y = node_id * 2 + 1
            F[dof_x] = force['fx']
            F[dof_y] = force['fy']
        
        return F
    
    def apply_boundary_conditions(self, K, F):
        n_nodes = len(self.nodes)
        free_dofs = []
        
        for node_id in range(n_nodes):
            if node_id not in self.supports:
                free_dofs.extend([node_id*2, node_id*2+1])
            else:
                support = self.supports[node_id]
                if support == 'roller_x':
                    free_dofs.append(node_id*2+1)
                elif support == 'roller_y':
                    free_dofs.append(node_id*2)
        
        free_dofs = np.array(free_dofs, dtype=int)
        K_reduced = K[np.ix_(free_dofs, free_dofs)]
        F_reduced = F[free_dofs]
        
        return K_reduced, F_reduced, free_dofs
    
    def solve(self):
        K = self.build_stiffness_matrix()
        F = self.build_load_vector()
        
        K_reduced, F_reduced, free_dofs = self.apply_boundary_conditions(K, F)
        
        u_reduced = solve(K_reduced, F_reduced)
        
        u = np.zeros(len(self.nodes) * 2)
        u[free_dofs] = u_reduced
        
        self.displacements = u
        self.calculate_member_forces()
        
        return self.get_results()
    
    def calculate_member_forces(self):
        self.member_forces = {}
        
        for member in self.members:
            node1 = member['node1']
            node2 = member['node2']
            member_id = member['id']
            
            u1_x = self.displacements[node1 * 2]
            u1_y = self.displacements[node1 * 2 + 1]
            u2_x = self.displacements[node2 * 2]
            u2_y = self.displacements[node2 * 2 + 1]
            
            L = self.get_member_length(node1, node2)
            angle = self.get_member_angle(node1, node2)
            
            c = np.cos(angle)
            s = np.sin(angle)
            
            delta_u = (u2_x - u1_x) * c + (u2_y - u1_y) * s
            strain = delta_u / L
            stress = self.E * strain
            force = stress * self.A
            
            force_type = "TENSION" if force > 0 else "COMPRESSION"
            
            self.member_forces[member_id] = {
                'force': float(force),
                'type': force_type,
                'stress': float(stress)
            }
    
    def get_results(self):
        return {
            'displacements': {str(k): {'ux': float(self.displacements[k*2]), 
                                        'uy': float(self.displacements[k*2+1])} 
                            for k in self.nodes.keys()},
            'member_forces': self.member_forces,
            'success': True
        }


@app.route('/api/analyze', methods=['POST'])
def analyze_truss():
    try:
        data = request.json
        
        # Create analyzer
        analyzer = TrussAnalyzer()
        analyzer.E = data.get('E', 200e9)
        analyzer.A = data.get('A', 0.01)
        
        # Add nodes
        for node in data['nodes']:
            analyzer.add_node(node['id'], node['x'], node['y'])
        
        # Add members
        for member in data['members']:
            analyzer.add_member(member['id'], member['node1'], member['node2'])
        
        # Add supports
        for support in data['supports']:
            analyzer.add_support(support['node_id'], support['type'])
        
        # Add forces
        for force in data['forces']:
            analyzer.add_force(force['node_id'], force['fx'], force['fy'])
        
        # Solve
        results = analyzer.solve()
        
        return jsonify(results)
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'Backend is running!'})


if __name__ == '__main__':
    app.run(debug=True, port=5000)